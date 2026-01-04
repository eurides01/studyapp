require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Como o server.js está em /backend e os models em /backend/models, o caminho ./models está correto
const User = require('./models/User');
const StudyData = require('./models/StudyData');

const app = express();

// 1. AUMENTO DO LIMITE DE DADOS (50mb)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors());

// Variável global para controlar novos registros
let REGISTRATION_OPEN = true; 

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Conectado!"))
    .catch(err => console.error("Erro Mongo:", err));

// Middleware de Autenticação
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

// Middleware de Admin
const adminAuth = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin') return res.status(403).json({ msg: 'Requer privilégios de admin' });
        next();
    } catch (e) {
        res.status(500).send('Erro servidor');
    }
};

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/api/auth/register', async (req, res) => {
    if (!REGISTRATION_OPEN) return res.status(403).json({ msg: 'Novos registros estão temporariamente bloqueados.' });

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
    } catch (err) {
        res.status(500).send('Erro no servidor');
    }
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
    } catch (err) {
        res.status(500).send('Erro no servidor');
    }
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
    } catch (err) {
        res.status(500).send('Erro no servidor');
    }
});

app.delete('/api/auth/account', auth, async (req, res) => {
    try {
        await StudyData.findOneAndDelete({ userId: req.user.id });
        await User.findByIdAndDelete(req.user.id);
        res.json({ msg: 'Conta excluída com sucesso.' });
    } catch (err) {
        res.status(500).send('Erro no servidor');
    }
});

// --- ROTAS DE ADMIN ---

app.get('/api/admin/users', auth, adminAuth, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json({ users, registrationOpen: REGISTRATION_OPEN });
    } catch (err) {
        res.status(500).send('Erro servidor');
    }
});

app.delete('/api/admin/user/:id', auth, adminAuth, async (req, res) => {
    try {
        await StudyData.findOneAndDelete({ userId: req.params.id });
        await User.findByIdAndDelete(req.params.id);
        res.json({ msg: 'Usuário removido pelo administrador.' });
    } catch (err) {
        res.status(500).send('Erro servidor');
    }
});

app.post('/api/admin/toggle-registration', auth, adminAuth, async (req, res) => {
    REGISTRATION_OPEN = !REGISTRATION_OPEN;
    res.json({ msg: `Novos registros ${REGISTRATION_OPEN ? 'LIBERADOS' : 'BLOQUEADOS'}.`, status: REGISTRATION_OPEN });
});

// --- ROTAS DE DADOS (SYNC) ---

app.get('/api/data', auth, async (req, res) => {
    try {
        const studyData = await StudyData.findOne({ userId: req.user.id });
        res.json(studyData ? studyData.data : {});
    } catch (err) { res.status(500).send('Erro'); }
});

app.post('/api/data', auth, async (req, res) => {
    try {
        await StudyData.findOneAndUpdate({ userId: req.user.id }, { $set: { data: req.body } }, { upsert: true });
        res.json({ msg: "Salvo" });
    } catch (err) { res.status(500).send('Erro ao salvar'); }
});

// --- 2. SERVIR ARQUIVOS ESTÁTICOS (Correção Definitiva) ---

// __dirname = .../meu-studyapp/backend
// ../frontend = .../meu-studyapp/frontend
const clientPath = path.join(__dirname, '../frontend');

app.use(express.static(clientPath));

// Rota "Coringa": Manda o index.html que está dentro da pasta frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));