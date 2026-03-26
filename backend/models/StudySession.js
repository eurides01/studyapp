const mongoose = require('mongoose');

const StudySessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    id: { type: String, required: true, unique: true }, // ID gerado no frontend
    editalId: String,
    disciplina: String,
    assunto: String,
    data: String,
    intervalo: String,
    total: Number,
    acertos: Number,
    percentual: Number,
    tempo: Number,
    revisoes: Array, // Array de objetos de revisão
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('StudySession', StudySessionSchema);