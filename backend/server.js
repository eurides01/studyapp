require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const StudyData = require('./models/StudyData');

const app = express();
app.use(express.json());
app.use(cors());

// Variável global para controlar novos registros (em memória)
// Em um sistema maior, isso ficaria no banco de dados.
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

// Registro
app.post('/api/auth/register', async (req, res) => {
    if (!REGISTRATION_OPEN) return res.status(403).json({ msg: 'Novos registros estão bloqueados pelo administrador.' });

    const { name, email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'Email já cadastrado' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({ name: name || 'Estudante', email, password: hashedPassword });
        await user.save();

        const initialData = { disciplinas: [], estudos: [], tempoEstudos: [], assuntosManuais: [], ciclo: { deck: [] } };
        await new StudyData({ userId: user.id, data: initialData }).save();

        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
        });
    } catch (err) {
        res.status(500).send('Erro no servidor');
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Email não encontrado' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Senha incorreta' });

        const payload = { user: { id: user.id } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
            if (err) throw err;
            // Retornamos também os dados do usuário para o frontend saber se é admin
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
        });
    } catch (err) {
        res.status(500).send('Erro no servidor');
    }
});

// --- ROTAS DE PERFIL DO USUÁRIO ---

// Atualizar Perfil (Nome e Senha)
app.put('/api/auth/profile', auth, async (req, res) => {
    const { name, password } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (name) user.name = name;
        if (password) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }
        await user.save();
        res.json({ msg: 'Perfil atualizado com sucesso!', user: { name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).send('Erro ao atualizar perfil');
    }
});

// Excluir Própria Conta
app.delete('/api/auth/account', auth, async (req, res) => {
    try {
        await StudyData.findOneAndDelete({ userId: req.user.id });
        await User.findByIdAndDelete(req.user.id);
        res.json({ msg: 'Conta excluída permanentemente.' });
    } catch (err) {
        res.status(500).send('Erro ao excluir conta');
    }
});

// --- ROTAS DE ADMINISTRADOR ---

// Listar Usuários
app.get('/api/admin/users', auth, adminAuth, async (req, res) => {
    try {
        // Traz todos os usuários menos a senha
        const users = await User.find().select('-password');
        res.json({ users, registrationOpen: REGISTRATION_OPEN });
    } catch (err) {
        res.status(500).send('Erro servidor');
    }
});

// Admin Excluir Usuário
app.delete('/api/admin/user/:id', auth, adminAuth, async (req, res) => {
    try {
        await StudyData.findOneAndDelete({ userId: req.params.id });
        await User.findByIdAndDelete(req.params.id);
        res.json({ msg: 'Usuário removido pelo administrador.' });
    } catch (err) {
        res.status(500).send('Erro servidor');
    }
});

// Alternar Bloqueio de Registro
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
    } catch (err) { res.status(500).send('Erro'); }
});

// --- FRONTEND ---
app.use(express.static(path.join(__dirname, '../frontend')));
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, '../frontend', 'index.html')));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));