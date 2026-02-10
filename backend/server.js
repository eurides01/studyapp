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

// --- ROTA DE KEEP-ALIVE (CRUCIAL PARA O RENDER) ---
// Configure o cron-job.org para chamar esta rota a cada 14 minutos
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

// 1. Rota de Carregamento Híbrido (GET) com DEDUPLICAÇÃO AUTOMÁTICA
app.get('/api/data', auth, async (req, res) => {
    try {
        // Busca dados antigos (Legado)
        const legacyDataDoc = await StudyData.findOne({ userId: req.user.id });
        let finalData = legacyDataDoc ? legacyDataDoc.data : {};

        if (!finalData.estudos) finalData.estudos = [];
        if (!finalData.tempoEstudos) finalData.tempoEstudos = [];

        // Busca dados novos (Granulares)
        const newSessions = await StudySession.find({ userId: req.user.id }).lean();
        const newTimes = await StudyTimeLog.find({ userId: req.user.id }).lean();

        // Limpa metadados do mongoose (_id, __v)
        const cleanList = (list) => list.map(item => {
            const { _id, userId, __v, ...rest } = item;
            return rest;
        });

        // --- LÓGICA DE DEDUPLICAÇÃO ---
        // Se um item existe na coleção nova, ignoramos a versão dele que está no legado
        const newIds = new Set(newSessions.map(s => s.id));
        const newTimeIds = new Set(newTimes.map(t => t.id));

        const legacyEstudosFiltered = finalData.estudos.filter(s => !newIds.has(s.id));
        const legacyTimesFiltered = finalData.tempoEstudos.filter(t => !newTimeIds.has(t.id));

        // Mescla final
        finalData.estudos = [...legacyEstudosFiltered, ...cleanList(newSessions)];
        finalData.tempoEstudos = [...legacyTimesFiltered, ...cleanList(newTimes)];

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
            // Idempotência: Só salva se não existir este ID
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

// 3. Rota de Atualização de Revisão (PUT) - NOVO FIX
// Atualiza status sem salvar o DB inteiro, evitando a duplicidade
app.put('/api/estudos/revisao', auth, async (req, res) => {
    try {
        const { studyId, revIndex } = req.body;

        // Tenta achar na coleção NOVA
        const session = await StudySession.findOne({ id: studyId, userId: req.user.id });
        if (session) {
            if (session.revisoes && session.revisoes[revIndex]) {
                session.revisoes[revIndex].concluida = true;
                session.markModified('revisoes'); 
                await session.save();
                return res.json({ msg: "Revisão atualizada (Moderno)" });
            }
        }

        // Se não achou, tenta achar na coleção LEGADA
        const legacy = await StudyData.findOne({ userId: req.user.id });
        if (legacy) {
            const sIndex = legacy.data.estudos.findIndex(s => s.id === studyId);
            if (sIndex > -1 && legacy.data.estudos[sIndex].revisoes[revIndex]) {
                legacy.data.estudos[sIndex].revisoes[revIndex].concluida = true;
                legacy.markModified('data');
                await legacy.save();
                return res.json({ msg: "Revisão atualizada (Legado)" });
            }
        }

        res.status(404).json({ msg: "Estudo não encontrado." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Erro ao atualizar revisão.' });
    }
});

// 4. Rota Legada (POST /data) - Apenas para configurações (Editais, Ciclos)
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

// --- ROTA DE FAXINA / LIMPEZA (NOVO) ---
app.post('/api/admin/cleanup', auth, adminAuth, async (req, res) => {
    try {
        console.log("Iniciando limpeza...");
        const users = await User.find();
        let totalRemoved = 0;
        let totalLegacyCleaned = 0;

        for (const user of users) {
            const userId = user._id;

            // 1. LIMPAR DUPLICATAS NA COLEÇÃO NOVA (StudySession)
            const allSessions = await StudySession.find({ userId }).sort({ _id: -1 });
            const seenIds = new Set();
            const idsToDelete = [];
            const uniqueSessionIds = new Set(); 

            for (const session of allSessions) {
                if (seenIds.has(session.id)) {
                    idsToDelete.push(session._id); // Duplicata
                } else {
                    seenIds.add(session.id);
                    uniqueSessionIds.add(session.id);
                }
            }

            if (idsToDelete.length > 0) {
                await StudySession.deleteMany({ _id: { $in: idsToDelete } });
                totalRemoved += idsToDelete.length;
            }

            // 2. LIMPAR DUPLICATAS NA COLEÇÃO DE TEMPO (StudyTimeLog)
            const allTimes = await StudyTimeLog.find({ userId }).sort({ _id: -1 });
            const seenTimeIds = new Set();
            const timeIdsToDelete = [];
            const uniqueTimeIds = new Set();

            for (const time of allTimes) {
                if (seenTimeIds.has(time.id)) {
                    timeIdsToDelete.push(time._id);
                } else {
                    seenTimeIds.add(time.id);
                    uniqueTimeIds.add(time.id);
                }
            }

            if (timeIdsToDelete.length > 0) {
                await StudyTimeLog.deleteMany({ _id: { $in: timeIdsToDelete } });
                totalRemoved += timeIdsToDelete.length;
            }

            // 3. LIMPAR LEGADO (Remover do JSON o que já está na coleção nova)
            const legacyData = await StudyData.findOne({ userId });
            if (legacyData && legacyData.data) {
                let changed = false;

                if (legacyData.data.estudos) {
                    const originalLen = legacyData.data.estudos.length;
                    legacyData.data.estudos = legacyData.data.estudos.filter(s => !uniqueSessionIds.has(s.id));
                    if (legacyData.data.estudos.length !== originalLen) changed = true;
                    totalLegacyCleaned += (originalLen - legacyData.data.estudos.length);
                }

                if (legacyData.data.tempoEstudos) {
                    const originalLen = legacyData.data.tempoEstudos.length;
                    legacyData.data.tempoEstudos = legacyData.data.tempoEstudos.filter(t => !uniqueTimeIds.has(t.id));
                    if (legacyData.data.tempoEstudos.length !== originalLen) changed = true;
                }

                if (changed) {
                    legacyData.markModified('data');
                    await legacyData.save();
                }
            }
        }

        res.json({ 
            msg: `Limpeza concluída!`, 
            details: `${totalRemoved} duplicatas removidas das coleções. ${totalLegacyCleaned} itens redundantes removidos do legado.`
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Erro durante a limpeza.' });
    }
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