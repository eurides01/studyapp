// js/state.js

export let authToken = localStorage.getItem('token');
export let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
export let currentEditalId = localStorage.getItem('lastEditalId') || null;
export let isSaving = false;
export let isLegacyRegistration = false;
export let charts = { acertos: null, tempo: null, cobertura: null, streak: null };

export let db = {
    editais: [],
    estudos: [],       
    tempoEstudos: [],  
    assuntosManuais: [],
    flashcardDecks: [], 
    flashcards: []      
};

// Funções para atualizar os estados globalmente
export const setAuthToken = (token) => { 
    authToken = token; 
    if(token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
};

export const setCurrentUser = (user) => { 
    currentUser = user; 
    if(user) localStorage.setItem('user', JSON.stringify(user));
    else localStorage.removeItem('user');
};

export const setCurrentEditalId = (id) => { 
    currentEditalId = id; 
    if(id) localStorage.setItem('lastEditalId', id);
    else localStorage.removeItem('lastEditalId');
};

export const setIsSaving = (val) => isSaving = val;
export const setIsLegacyRegistration = (val) => isLegacyRegistration = val;
export const setDb = (newDb) => { db = { ...db, ...newDb }; };

// Utilitários de Texto e Datas
export const escapeQuotes = (str) => {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
};

export const getTodayDate = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const formatDateBr = (dateStr) => {
    if(!dateStr) return "-";
    if(dateStr === 'SEM_DATA') return "Data desc.";
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const [y, m, d] = cleanDate.split('-');
    return `${d}/${m}/${y}`;
};

export const formatDuration = (m) => `${Math.floor(m/60)}h ${m%60}m`;

export const addDays = (dateStr, days) => {
    if (!dateStr || dateStr === 'SEM_DATA') return 'SEM_DATA';
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const [y, m, d] = cleanDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    dateObj.setDate(dateObj.getDate() + days);
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
};

export const diffInDays = (date1Str, date2Str) => {
    if(!date1Str || !date2Str || date1Str === 'SEM_DATA' || date2Str === 'SEM_DATA') return 0;
    const d1 = new Date(date1Str.includes('T') ? date1Str.split('T')[0] : date1Str);
    const d2 = new Date(date2Str.includes('T') ? date2Str.split('T')[0] : date2Str);
    d1.setHours(0,0,0,0);
    d2.setHours(0,0,0,0);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
};

export const getTaskNumber = (str) => {
    if (!str) return 999999;
    const match = str.match(/^T(\d+)/i); 
    return match ? parseInt(match[1]) : 999999;
};

// Consultas comuns no BD
export const getCurrentEdital = () => {
    if (!currentEditalId || db.editais.length === 0) return null;
    return db.editais.find(e => e.id === currentEditalId) || null;
};

export const filterStudiesByEdital = (list) => {
    const edital = getCurrentEdital();
    if(!edital) return [];
    const discNames = edital.disciplinas.map(d => d.nome);
    return list.filter(item => {
        if (!item) return false;
        if (item.editalId) return item.editalId === edital.id;
        return discNames.includes(item.disciplina);
    });
};