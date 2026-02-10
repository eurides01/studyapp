require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const compression = require('compression'); // Otimização de performance

// Importação dos Models
const User = require('./models/User');
const StudyData = require('./models/StudyData');
const StudySession = require('./models/StudySession');
const StudyTimeLog = require('./models/StudyTimeLog');

const app = express();

// Configurações de Middleware
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Variável global para controlar novos registros
let REGISTRATION_OPEN = true; 

// --- ROTA DE KEEP-ALIVE (SOLUÇÃO PARA O RENDER) ---
// Essa rota será chamada a cada 14 minutos por um serviço externo para impedir que o servidor durma.
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Conectado!"))
    .catch(err => console.error("Erro Mongo:", err));

// --- Middlewares de Auth ---
const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ msg: 'Acesso negado' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user;
        next();
    } catch (e) {
        res.status(400).json({ msg: 'Token inválido' });
    }
};

const adminAuth = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'Requer privilégios de admin' });
        next();
    } catch (e) {
        res.status(500).send('Erro servidor');
    }
};

// --- ROTAS DE DADOS (SYNC INTELIGENTE) ---

// 1. Rota de Carregamento Híbrido (GET)
app.get('/api/data', auth, async (req, res) => {
    try {
        const legacyDataDoc = await StudyData.findOne({ userId: req.user.id });
        let finalData = legacyDataDoc ? legacyDataDoc.data : {};

        if (!finalData.estudos) finalData.estudos = [];
        if (!finalData.tempoEstudos) finalData.tempoEstudos = [];

        const newSessions = await StudySession.find({ userId: req.user.id }).lean();
        const newTimes = await StudyTimeLog.find({ userId: req.user.id }).lean();

        const cleanList = (list) => list.map(item => {
            const { _id, userId, __v, ...rest } = item;
            return rest;
        });

        finalData.estudos = [...finalData.estudos, ...cleanList(newSessions)];
        finalData.tempoEstudos = [...finalData.tempoEstudos, ...cleanList(newTimes)];

        res.json(finalData);
    } catch (err) { 
        console.error(err);
        res.status(500).send('Erro ao carregar dados'); 
    }
});

// 2. Rota de Salvamento Incremental (POST)
app.post('/api/estudos', auth, async (req, res) => {
    try {
        const { estudo, tempo } = req.body;
        
        if (estudo) {
            // Idempotência: Evita duplicidade checando se o ID já existe
            const exists = await StudySession.findOne({ id: estudo.id, userId: req.user.id });
            if (!exists) {
                await new StudySession({ ...estudo, userId: req.user.id }).save();
            }
        }

        if (tempo) {
            const existsTime = await StudyTimeLog.findOne({ id: tempo.id, userId: req.user.id });
            if (!existsTime) {
                await new StudyTimeLog({ ...tempo, userId: req.user.id }).save();
            }
        }

        res.json({ msg: "Sincronizado com sucesso!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Erro ao salvar registro incremental.' });
    }
});

// 3. Rota Legada (POST /data) - Apenas configurações
app.post('/api/data', auth, async (req, res) => {
    try {
        await StudyData.findOneAndUpdate({ userId: req.user.id }, { $set: { data: req.body } }, { upsert: true });
        res.json({ msg: "Configurações salvas" });
    } catch (err) { res.status(500).send('Erro ao salvar configurações'); }
});

// --- ROTAS DE AUTENTICAÇÃO & ADMIN ---

app.post('/api/auth/register', async (req, res) => {
    if (!REGISTRATION_OPEN) return res.status(403).json({ msg: 'Novos registros bloqueados.' });
    const { name, email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'Email já cadastrado' });
        user = new User({ name, email, password });
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();
        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
        });
    } catch (err) { res.status(500).send('Erro servidor'); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Credenciais inválidas' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Credenciais inválidas' });
        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
        });
    } catch (err) { res.status(500).send('Erro servidor'); }
});

app.put('/api/auth/profile', auth, async (req, res) => {
    const { name, password } = req.body;
    try {
        let user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'Usuário não encontrado' });
        if (name) user.name = name;
        if (password) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }
        await user.save();
        res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (err) { res.status(500).send('Erro servidor'); }
});

app.delete('/api/auth/account', auth, async (req, res) => {
    try {
        await StudyData.findOneAndDelete({ userId: req.user.id });
        await User.findByIdAndDelete(req.user.id);
        await StudySession.deleteMany({ userId: req.user.id });
        await StudyTimeLog.deleteMany({ userId: req.user.id });
        res.json({ msg: 'Conta excluída.' });
    } catch (err) { res.status(500).send('Erro servidor'); }
});

app.get('/api/admin/users', auth, adminAuth, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json({ users, registrationOpen: REGISTRATION_OPEN });
    } catch (err) { res.status(500).send('Erro servidor'); }
});

app.delete('/api/admin/user/:id', auth, adminAuth, async (req, res) => {
    try {
        await StudyData.findOneAndDelete({ userId: req.params.id });
        await User.findByIdAndDelete(req.params.id);
        await StudySession.deleteMany({ userId: req.params.id });
        await StudyTimeLog.deleteMany({ userId: req.params.id });
        res.json({ msg: 'Usuário removido.' });
    } catch (err) { res.status(500).send('Erro servidor'); }
});

app.post('/api/admin/toggle-registration', auth, adminAuth, async (req, res) => {
    REGISTRATION_OPEN = !REGISTRATION_OPEN;
    res.json({ msg: `Novos registros ${REGISTRATION_OPEN ? 'LIBERADOS' : 'BLOQUEADOS'}.`, status: REGISTRATION_OPEN });
});

// --- ARQUIVOS ESTÁTICOS ---
const clientPath = path.join(__dirname, '../frontend');
app.use(express.static(clientPath));
app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));