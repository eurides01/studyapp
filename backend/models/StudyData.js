const mongoose = require('mongoose');

const StudyDataSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    data: { type: Object, required: true } // Aqui guardaremos suas disciplinas, tempo, etc.
});

module.exports = mongoose.model('StudyData', StudyDataSchema);