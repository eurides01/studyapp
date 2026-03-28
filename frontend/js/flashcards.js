// js/flashcards.js
import { db, getCurrentEdital, getTodayDate, addDays, formatDateBr } from './state.js';
import { apiSaveData, apiSaveIncremental } from './api.js';

let currentStudySessionCards = [];
let currentFlashcard = null;
let currentStudyDeckId = null;
let waitTimerInterval = null;
let fcSessionStartTime = null;
let fcSessionReviewed = 0;
let fcSessionCorrect = 0;
let currentManageDeckId = null;

const STEPS = [1, 10]; 
const GRADUATING_IVL = 1; 
const EASY_IVL = 4;

const getCardsForDeck = (deckId) => db.flashcards.filter(c => c && c.deckId === deckId);

const getDueCardsToday = (deckId = null, editalDecksIds = null) => {
    const today = getTodayDate();
    return db.flashcards.filter(c => {
        if (!c) return false;
        if (deckId && c.deckId !== deckId) return false;
        if (!deckId && editalDecksIds && !editalDecksIds.includes(c.deckId)) return false;
        return !c.nextReview || c.nextReview <= today;
    });
};

export const renderFlashcardsDashboard = () => {
    const list = document.getElementById('decks-list');
    list.innerHTML = '';
    const edital = getCurrentEdital();
    if (!edital) {
        list.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">Selecione ou crie um edital para ver seus flashcards.</div>';
        return;
    }
    const editalDecks = db.flashcardDecks.filter(d => d && d.editalId === edital.id);
    if (editalDecks.length === 0) {
        list.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">Nenhum deck criado para este edital ainda.</div>';
        return;
    }

    editalDecks.forEach(deck => {
        const dueCards = getDueCardsToday(deck.id, null);
        const countNew = dueCards.filter(c => c.status === 'new').length;
        const countLearn = dueCards.filter(c => c.status === 'learning').length;
        const countReview = dueCards.filter(c => c.status === 'review').length;

        // ETIQUETAS VISUAIS (BADGES) COM ÍCONES
        const countsHtml = dueCards.length > 0 
            ? `<div class="anki-counts">
                 <span class="fc-status-badge fc-status-new" title="Cards Novos"><i class="ph ph-sparkle"></i> ${countNew}</span>
                 <span class="fc-status-badge fc-status-learn" title="Em Aprendizagem"><i class="ph ph-brain"></i> ${countLearn}</span>
                 <span class="fc-status-badge fc-status-review" title="Para Revisão"><i class="ph ph-arrows-clockwise"></i> ${countReview}</span>
               </div>` 
            : `<div class="anki-counts"><span class="fc-status-badge" style="background:var(--border-color); color:var(--text-light)"><i class="ph ph-check-circle"></i> Tudo em dia!</span></div>`;

        list.innerHTML += `
        <div class="card deck-item" style="margin-bottom:0; flex-direction: row; flex-wrap:wrap; gap:15px;">
            <div class="deck-info" style="flex:1; min-width:200px;">
                <strong>${deck.name}</strong>
                ${countsHtml}
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
                <button class="btn-primary btn-sm" onclick="startFlashcardsStudy('${deck.id}')" ${dueCards.length === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}><i class="ph ph-play"></i> Estudar</button>
                <button class="icon-btn btn-secondary" onclick="openManageCards('${deck.id}')" title="Gerir Cartões"><i class="ph ph-list"></i></button>
                <button class="icon-action-btn btn-trash" onclick="deleteDeck('${deck.id}')"><i class="ph ph-trash"></i></button>
            </div>
        </div>`;
    });

    const opts = editalDecks.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    document.getElementById('new-card-deck-select').innerHTML = opts;
    document.getElementById('import-card-deck-select').innerHTML = opts;
};

export const startFlashcardsStudy = (deckId, fallbackEditalDecksIds = null) => {
    currentStudyDeckId = deckId;
    const editalDecksIds = fallbackEditalDecksIds || (deckId ? null : db.flashcardDecks.filter(d => d.editalId === getCurrentEdital()?.id).map(d => d.id));
    currentStudySessionCards = getDueCardsToday(deckId, editalDecksIds);
    
    if (currentStudySessionCards.length === 0) return alert('Nenhum card pendente para estudo agora.');

    fcSessionStartTime = Date.now();
    fcSessionReviewed = 0;
    fcSessionCorrect = 0;

    document.getElementById('flashcards-dashboard').style.display = 'none';
    document.getElementById('flashcards-study-area').style.display = 'block';
    
    if(deckId) {
        const d = db.flashcardDecks.find(x => x.id === deckId);
        document.getElementById('study-deck-title').textContent = d ? d.name : "Estudando";
    } else document.getElementById('study-deck-title').textContent = "Revisão Geral";

    renderNextFlashcard();
};

const calculateIntervalsPreview = (card) => {
    const preview = { bad: '', hard: '', good: '', easy: '', showHard: true };
    let cStatus = card.status || (card.interval > 0 ? 'review' : 'new');
    let cStep = card.stepIndex || 0;
    let cInt = card.interval || 0;
    let cEase = card.ease || 2.5;

    if (cStatus === 'new' || cStatus === 'learning') {
        preview.showHard = true; 
        if (cStep === 0) { preview.bad = '<1m'; preview.hard = '1m'; preview.good = '10m'; preview.easy = '4d'; } 
        else { preview.bad = '<1m'; preview.hard = '10m'; preview.good = '1d'; preview.easy = '4d'; }
    } else {
        preview.showHard = true; preview.bad = '10m'; 
        let hardInt = Math.max(1, Math.round(cInt * 1.2));
        let goodInt = Math.max(1, Math.round(cInt * cEase));
        let easyInt = Math.max(1, Math.round(cInt * cEase * 1.3));
        preview.hard = hardInt + 'd'; preview.good = goodInt + 'd'; preview.easy = easyInt + 'd';
    }
    return preview;
};

const renderNextFlashcard = () => {
    if (waitTimerInterval) clearTimeout(waitTimerInterval);
    const editalDecksIds = currentStudyDeckId ? null : db.flashcardDecks.filter(d => d.editalId === getCurrentEdital()?.id).map(d => d.id);
    currentStudySessionCards = getDueCardsToday(currentStudyDeckId, editalDecksIds);

    const countNew = currentStudySessionCards.filter(c => c.status === 'new').length;
    const countLearn = currentStudySessionCards.filter(c => c.status === 'learning').length;
    const countReview = currentStudySessionCards.filter(c => c.status === 'review').length;

    // ETIQUETAS VISUAIS NO CABEÇALHO DO ESTUDO
    document.getElementById('study-cards-left').innerHTML = `
        <div class="anki-counts">
             <span class="fc-status-badge fc-status-new" title="Cards Novos"><i class="ph ph-sparkle"></i> ${countNew}</span>
             <span class="fc-status-badge fc-status-learn" title="Em Aprendizagem"><i class="ph ph-brain"></i> ${countLearn}</span>
             <span class="fc-status-badge fc-status-review" title="Para Revisão"><i class="ph ph-arrows-clockwise"></i> ${countReview}</span>
        </div>`;

    if (currentStudySessionCards.length === 0) {
        finishFlashcardSession();
        document.getElementById('fc-front-text').textContent = "Parabéns!"; document.getElementById('fc-front-text').classList.remove('fc-waiting');
        document.getElementById('fc-back-text').textContent = "Você concluiu os estudos de hoje para este bloco.";
        document.getElementById('fc-actions').style.display = 'none'; document.querySelector('.fc-hint').style.display = 'none';
        document.getElementById('fc-deck-name').textContent = "Concluído"; currentFlashcard = null;
        return;
    }

    const now = Date.now();
    const readyCards = currentStudySessionCards.filter(c => !c.nextReviewTime || c.nextReviewTime <= now);
    const waitingCards = currentStudySessionCards.filter(c => c.nextReviewTime && c.nextReviewTime > now);

    if (readyCards.length === 0 && waitingCards.length > 0) {
        waitingCards.sort((a, b) => a.nextReviewTime - b.nextReviewTime);
        const nextCard = waitingCards[0];
        const waitMs = nextCard.nextReviewTime - now;
        const waitMins = Math.ceil(waitMs / 60000);

        document.getElementById('fc-container').classList.remove('flipped'); document.getElementById('fc-actions').style.display = 'none';
        document.querySelector('.fc-hint').style.display = 'none'; document.getElementById('fc-deck-name').textContent = "Aguarde";
        document.getElementById('fc-front-text').classList.add('fc-waiting');
        document.getElementById('fc-front-text').innerHTML = `<div class="fc-wait-screen"><i class="ph ph-hourglass-high" style="font-size:3rem; color:var(--primary-color);"></i><span>Próximo card em:</span><div class="fc-wait-time">${waitMins} min</div><small style="color:var(--text-light)">Aguardando o intervalo de fixação.</small></div>`;

        waitTimerInterval = setTimeout(renderNextFlashcard, waitMs + 500); currentFlashcard = null; return;
    }

    let nextCard = readyCards.find(c => c.status === 'learning') || readyCards.find(c => c.status === 'review') || readyCards.find(c => c.status === 'new');
    currentFlashcard = nextCard;
    
    const deckObj = db.flashcardDecks.find(d => d.id === currentFlashcard.deckId);
    document.getElementById('fc-deck-name').textContent = deckObj ? deckObj.name : "Card";
    document.getElementById('fc-front-text').classList.remove('fc-waiting');
    document.getElementById('fc-front-text').innerHTML = currentFlashcard.front; document.getElementById('fc-back-text').innerHTML = currentFlashcard.back;

    const previews = calculateIntervalsPreview(currentFlashcard);
    document.querySelector('.fc-bad small').textContent = previews.bad;
    const hardBtn = document.querySelector('.fc-hard');
    if (previews.showHard) { hardBtn.style.display = 'block'; document.getElementById('lbl-hard').textContent = previews.hard; } 
    else { hardBtn.style.display = 'none'; }
    document.getElementById('lbl-good').textContent = previews.good; document.getElementById('lbl-easy').textContent = previews.easy;

    document.getElementById('fc-container').classList.remove('flipped'); document.getElementById('fc-actions').style.display = 'none'; document.querySelector('.fc-hint').style.display = 'block';
};

export const rateFlashcard = (quality) => {
    if (!currentFlashcard) return;
    let card = db.flashcards.find(c => c.id === currentFlashcard.id);
    if(!card) return;

    fcSessionReviewed++;
    if (quality >= 2) fcSessionCorrect++;

    const now = Date.now();
    const today = getTodayDate();

    if (!card.status) card.status = (card.interval > 0) ? 'review' : 'new';
    if (typeof card.stepIndex !== 'number') card.stepIndex = 0;
    if (typeof card.ease !== 'number') card.ease = 2.5;
    if (typeof card.interval !== 'number') card.interval = 0;
    if (typeof card.reps !== 'number') card.reps = (card.interval > 0) ? 1 : 0;

    if (card.status === 'new' || card.status === 'learning') {
        if (card.status === 'new') card.stepIndex = 0;
        card.status = 'learning';

        if (quality === 1) { card.stepIndex = 0; card.nextReviewTime = now + (STEPS[0] * 60000); } 
        else if (quality === 2) { card.nextReviewTime = now + (STEPS[card.stepIndex] * 60000); } 
        else if (quality === 3) { 
            card.stepIndex++;
            if (card.stepIndex < STEPS.length) { card.nextReviewTime = now + (STEPS[card.stepIndex] * 60000); } 
            else { card.status = 'review'; card.interval = GRADUATING_IVL; card.reps = 1; card.nextReviewTime = null; card.nextReview = addDays(today, card.interval); }
        } 
        else if (quality === 4) { card.status = 'review'; card.interval = EASY_IVL; card.reps = 1; card.nextReviewTime = null; card.nextReview = addDays(today, card.interval); }
    } 
    else if (card.status === 'review') { 
        if (quality === 1) { card.status = 'learning'; card.stepIndex = 1; card.ease = Math.max(1.3, card.ease - 0.20); card.interval = 1; card.nextReviewTime = now + (10 * 60000); } 
        else {
            card.reps = (card.reps || 0) + 1;
            if (quality === 2) { card.ease = Math.max(1.3, card.ease - 0.15); card.interval = Math.max(1, Math.round(card.interval * 1.2)); } 
            else if (quality === 3) { card.interval = Math.max(1, Math.round(card.interval * card.ease)); } 
            else if (quality === 4) { card.ease += 0.15; card.interval = Math.max(1, Math.round(card.interval * card.ease * 1.3)); }
            card.nextReviewTime = null; card.nextReview = addDays(today, card.interval);
        }
    }
    apiSaveData(db);
    renderNextFlashcard();
};

export const finishFlashcardSession = async () => {
    if (fcSessionReviewed > 0 && fcSessionStartTime) {
        const elapsedMins = Math.ceil((Date.now() - fcSessionStartTime) / 60000);
        const edital = getCurrentEdital();
        const deckName = currentStudyDeckId ? db.flashcardDecks.find(d => d.id === currentStudyDeckId)?.name : 'Revisão Geral';

        const novoEstudo = { id: Date.now().toString() + '_fc', editalId: edital.id, data: getTodayDate(), disciplina: 'Flashcards', assunto: deckName, intervalo: null, total: fcSessionReviewed, acertos: fcSessionCorrect, percentual: Math.round((fcSessionCorrect / fcSessionReviewed) * 100), tempo: elapsedMins, revisoes: [] };
        const novoTempo = { id: Date.now().toString() + '_fc_t', editalId: edital.id, data: getTodayDate(), disciplina: 'Flashcards', assunto: deckName, tempoMinutos: elapsedMins, tipo: 'revisao' };

        db.estudos.push(novoEstudo); db.tempoEstudos.push(novoTempo);

        try { await apiSaveIncremental({ estudo: novoEstudo, tempo: novoTempo }); await apiSaveData(db); } 
        catch (e) { console.error("Falha ao sincronizar Flashcards", e); }
        
        fcSessionReviewed = 0; fcSessionCorrect = 0; fcSessionStartTime = null;
    }
};

export const renderScheduledCards = () => {
    const container = document.getElementById('scheduled-cards-container'); container.innerHTML = '';
    const edital = getCurrentEdital(); if (!edital) return;
    const today = getTodayDate();
    const editalDecksIds = db.flashcardDecks.filter(d => d.editalId === edital.id).map(d => d.id);
    const futureCards = db.flashcards.filter(c => c.nextReview && c.nextReview > today && editalDecksIds.includes(c.deckId));

    if (futureCards.length === 0) { container.innerHTML = '<p class="empty-state">Nenhum card agendado para dias futuros. Você está em dia!</p>'; return; }

    const grouped = {};
    futureCards.forEach(c => { if (!grouped[c.deckId]) grouped[c.deckId] = []; grouped[c.deckId].push(c); });

    let html = '';
    for (const deckId in grouped) {
        const deck = db.flashcardDecks.find(d => d.id === deckId);
        const cards = grouped[deckId].sort((a, b) => a.nextReview.localeCompare(b.nextReview));
        html += `<div style="margin-bottom: 1.5rem;"><h4 style="color:var(--primary-color); border-bottom: 1px solid var(--border-color); padding-bottom: 5px; margin-bottom: 10px;">${deck ? deck.name : 'Deck Removido'} <span style="color:var(--text-light); font-size:0.8rem; font-weight:normal;">(${cards.length} cards)</span></h4><div style="display:flex; flex-direction:column; gap:8px;">`;
        cards.forEach(c => { html += `<div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.02); padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); font-size:0.9rem;"><span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-right:10px;" title="${c.front}">${c.front}</span><span style="font-weight:600; color:var(--warning-color); white-space:nowrap;"><i class="ph ph-calendar"></i> ${formatDateBr(c.nextReview)}</span></div>`; });
        html += `</div></div>`;
    }
    container.innerHTML = html;
};

export const openManageCards = (deckId) => {
    currentManageDeckId = deckId;
    const deck = db.flashcardDecks.find(d => d.id === deckId);
    document.getElementById('manage-deck-title').textContent = deck ? deck.name : '';
    renderManageCardsList();
    document.getElementById('modal-backdrop').classList.add('active'); document.getElementById('manage-cards-modal').classList.add('active');
};

const renderManageCardsList = () => {
    const list = document.getElementById('manage-cards-list');
    const cards = db.flashcards.filter(c => c.deckId === currentManageDeckId);
    if(cards.length === 0) { list.innerHTML = '<p class="empty-state">Este deck está vazio.</p>'; return; }
    
    let html = '<div style="display:flex; flex-direction:column;">';
    cards.forEach(c => {
        // Aproveitando as cores do CSS para o gerenciador de cards também
        let statusLabel = '';
        if(c.status === 'new') statusLabel = '<span class="fc-status-badge fc-status-new" style="font-size:0.7rem; padding:2px 6px;">Novo</span>';
        else if(c.status === 'learning') statusLabel = '<span class="fc-status-badge fc-status-learn" style="font-size:0.7rem; padding:2px 6px;">Aprendendo</span>';
        else statusLabel = '<span class="fc-status-badge fc-status-review" style="font-size:0.7rem; padding:2px 6px;">Revisão</span>';

        html += `<div class="fc-manage-item"><div class="fc-manage-text"><strong>F: ${c.front}</strong><span>V: ${c.back}</span><div style="font-size:0.75rem; color:var(--text-light); margin-top:6px; font-weight:500; display:flex; align-items:center; gap:8px;">${statusLabel} <span>Próxima rev: ${formatDateBr(c.nextReview)}</span></div></div><div class="fc-manage-actions"><button class="icon-action-btn btn-edit" onclick="openEditCard('${c.id}')"><i class="ph ph-pencil-simple"></i></button><button class="icon-action-btn btn-trash" onclick="deleteSingleCard('${c.id}')"><i class="ph ph-trash"></i></button></div></div>`;
    });
    list.innerHTML = html + '</div>';
};

export const deleteSingleCard = (cardId) => {
    if(confirm("Tem certeza que deseja excluir este cartão?")) {
        db.flashcards = db.flashcards.filter(c => c.id !== cardId);
        apiSaveData(db); renderManageCardsList(); renderFlashcardsDashboard(); 
    }
};

export const deleteDeck = (id) => {
    if(confirm("Excluir este deck e TODOS os seus cards?")) {
        db.flashcardDecks = db.flashcardDecks.filter(d => d.id !== id);
        db.flashcards = db.flashcards.filter(c => c.deckId !== id);
        apiSaveData(db); renderFlashcardsDashboard();
    }
};

export const openEditCard = (cardId) => {
    const card = db.flashcards.find(c => c.id === cardId); if(!card) return;
    document.getElementById('edit-card-id').value = card.id;
    document.getElementById('edit-card-front').value = card.front; document.getElementById('edit-card-back').value = card.back;
    document.getElementById('manage-cards-modal').classList.remove('active'); document.getElementById('edit-card-modal').classList.add('active');
};

export const saveEditedCard = () => {
    const id = document.getElementById('edit-card-id').value;
    const front = document.getElementById('edit-card-front').value.trim(); const back = document.getElementById('edit-card-back').value.trim();
    if(!front || !back) return alert("Preencha frente e verso.");
    const card = db.flashcards.find(c => c.id === id);
    if(card) {
        card.front = front; card.back = back; apiSaveData(db);
        document.getElementById('edit-card-modal').classList.remove('active'); document.getElementById('manage-cards-modal').classList.add('active');
        renderManageCardsList(); renderFlashcardsDashboard();
    }
};

// Tornar funções globais para o HTML acessá-las
window.startFlashcardsStudy = startFlashcardsStudy;
window.rateFlashcard = rateFlashcard;
window.openManageCards = openManageCards;
window.deleteSingleCard = deleteSingleCard;
window.deleteDeck = deleteDeck;
window.openEditCard = openEditCard;