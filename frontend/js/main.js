// js/main.js
import { authToken, currentUser, currentEditalId, db, setAuthToken, setCurrentUser, setCurrentEditalId, setDb, getCurrentEdital, getTodayDate } from './state.js';
import { API_URL, apiAuthRequest, apiFetchData, apiSaveData } from './api.js';
import { initTimerDOM } from './timer.js';
import { openRegistroModal, openRevisaoModal, salvarRegistro, salvarRevisao, showPage, updateEditalUI, renderHomePage, renderCicloConfig, renderDisciplinas, toggleAssuntoConcluido, removeAssunto, removeDisciplina, addAssuntoRapido, editDisciplina, editAssunto } from './ui.js';
import { saveEditedCard, renderScheduledCards, startFlashcardsStudy, renderFlashcardsDashboard, finishFlashcardSession, rateFlashcard, openManageCards, deleteSingleCard, deleteDeck, openEditCard } from './flashcards.js';
import { generatePDF, renderEstatisticas } from './stats.js';

// === GARANTIA DE ESCOPO GLOBAL ===
window.toggleAssuntoConcluido = toggleAssuntoConcluido;
window.removeAssunto = removeAssunto;
window.removeDisciplina = removeDisciplina;
window.addAssuntoRapido = addAssuntoRapido;
window.openRegistroModal = openRegistroModal;
window.openRevisaoModal = openRevisaoModal;
window.rateFlashcard = rateFlashcard;
window.openManageCards = openManageCards;
window.deleteSingleCard = deleteSingleCard;
window.deleteDeck = deleteDeck;
window.openEditCard = openEditCard;
window.startFlashcardsStudy = startFlashcardsStudy;
window.editDisciplina = editDisciplina;
window.editAssunto = editAssunto;

document.addEventListener('DOMContentLoaded', () => {

    const checkAuth = () => {
        if(authToken) {
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('sidebar').style.display = 'flex';
            if(document.getElementById('mobile-menu-btn')) document.getElementById('mobile-menu-btn').style.display = ''; 
            if(document.querySelector('.container')) document.querySelector('.container').style.display = 'block';
            
            const isAdmin = (currentUser && currentUser.role === 'admin');
            const btnAdmin = document.getElementById('btn-admin-panel');
            if (btnAdmin) btnAdmin.style.display = isAdmin ? 'flex' : 'none';

            loadDataFromCloud();
        } else {
            document.getElementById('auth-screen').style.display = 'flex';
            document.getElementById('sidebar').style.display = 'none';
            if(document.getElementById('mobile-menu-btn')) document.getElementById('mobile-menu-btn').style.display = 'none'; 
            if(document.querySelector('.container')) document.querySelector('.container').style.display = 'none';
        }
    };

    const handleAuth = async (endpoint) => {
        const email = document.getElementById('login-email').value; const password = document.getElementById('login-password').value;
        if(!email || !password) return alert("Preencha o email e a senha!");
        
        try {
            const res = await apiAuthRequest(endpoint, email, password); const data = await res.json();
            if(res.ok) { setAuthToken(data.token); setCurrentUser(data.user); checkAuth(); } 
            else alert(data.msg || "Erro ao conectar.");
        } catch(err) { console.error(err); alert("Erro de conexão."); }
    };

    document.getElementById('btn-login')?.addEventListener('click', () => handleAuth('login'));
    document.getElementById('btn-logout')?.addEventListener('click', () => { localStorage.clear(); location.reload(); });

    const loadDataFromCloud = async () => {
        if(!authToken) return;
        try {
            const res = await apiFetchData();
            if(res.ok) {
                const cloudData = await res.json();
                
                if (cloudData.disciplinas && cloudData.disciplinas.length > 0 && (!cloudData.editais || cloudData.editais.length === 0)) {
                    cloudData.editais = [{ id: 'default-edital', nome: 'Meu Edital', disciplinas: cloudData.disciplinas, ciclo: cloudData.ciclo || { deck: [], disciplinasPorDia: 3, metaHoras: 4 } }];
                    delete cloudData.disciplinas; delete cloudData.ciclo;
                    setDb(cloudData); apiSaveData(db);
                } else setDb(cloudData);

                if (!db.editais) db.editais = []; if (!db.estudos) db.estudos = []; if (!db.tempoEstudos) db.tempoEstudos = [];
                if (!db.assuntosManuais) db.assuntosManuais = []; if (!db.flashcardDecks) db.flashcardDecks = []; if (!db.flashcards) db.flashcards = [];
                
                let needSave = false;
                if (db.editais.length > 0) db.flashcardDecks.forEach(d => { if (!d.editalId) { d.editalId = db.editais[0].id; needSave = true; } });
                
                db.flashcards.forEach(c => {
                    if (c.interval > 0) c.status = 'review';
                    else if (!c.status || c.status === 'graduated') { c.status = 'new'; needSave = true; }
                    if (typeof c.stepIndex !== 'number') c.stepIndex = 0; if (typeof c.ease !== 'number') c.ease = 2.5;
                    if (typeof c.interval !== 'number') c.interval = 0; if (typeof c.reps !== 'number') c.reps = (c.interval > 0) ? 1 : 0;
                });
                
                if(needSave) apiSaveData(db);

                if (db.editais.length > 0) { if (!currentEditalId || !db.editais.find(e => e.id === currentEditalId)) setCurrentEditalId(db.editais[0].id); } 
                else setCurrentEditalId(null);

                updateEditalUI(); renderHomePage();
                document.body.dataset.theme = localStorage.getItem('studyAppTheme') || 'light';
            } else if(res.status === 401) { localStorage.clear(); location.reload(); }
        } catch (err) { console.error("Erro loadData", err); }
    };

    // Navegação Sidebar
    document.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', (e) => { 
        if(l.dataset.page) { e.preventDefault(); showPage(l.dataset.page); }
    }));
    
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        if (window.innerWidth <= 1024) document.getElementById('sidebar').classList.remove('show');
        else { document.getElementById('sidebar').classList.toggle('collapsed'); document.querySelector('.container').classList.toggle('collapsed'); }
    });

    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => document.getElementById('sidebar').classList.add('show'));

    const handleEditalChange = (e) => {
        const newId = e.target.value; if(!newId) return;
        setCurrentEditalId(newId); updateEditalUI();
        const activePageId = document.querySelector('.page.active').id; showPage(activePageId);
    };

    document.getElementById('edital-selector')?.addEventListener('change', handleEditalChange);
    document.getElementById('navbar-edital-select')?.addEventListener('change', handleEditalChange);

    // ==========================================
    // LÓGICA DE EDITAIS E DISCIPLINAS
    // ==========================================
    document.getElementById('btn-new-edital')?.addEventListener('click', () => {
        document.getElementById('new-edital-name').value = '';
        const chk = document.getElementById('new-edital-is-trilha');
        if(chk) chk.checked = false;
        document.getElementById('modal-backdrop').classList.add('active');
        document.getElementById('new-edital-modal').classList.add('active');
    });

    document.getElementById('btn-save-edital')?.addEventListener('click', () => {
        const nome = document.getElementById('new-edital-name').value.trim();
        const chk = document.getElementById('new-edital-is-trilha');
        const isTrilha = chk ? chk.checked : false;
        if(!nome) return alert("Digite o nome.");
        const newEdital = {
            id: Date.now().toString(), nome: nome, isTrilha: isTrilha, disciplinas: [], ciclo: { deck: [], disciplinasPorDia: 3, metaHoras: 4, pesos: {} }
        };
        db.editais.push(newEdital);
        setCurrentEditalId(newEdital.id);
        apiSaveData(db); updateEditalUI();
        document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('new-edital-modal').classList.remove('active');
        showPage('page-estudos');
    });

    document.getElementById('btn-delete-edital')?.addEventListener('click', () => {
        const edital = getCurrentEdital(); if(!edital) return;
        if(confirm(`Tem certeza que deseja apagar o edital "${edital.nome}" e todas as suas disciplinas?`)) {
            db.editais = db.editais.filter(e => e.id !== currentEditalId);
            db.flashcardDecks = db.flashcardDecks.filter(d => d.editalId !== currentEditalId);
            db.flashcards = db.flashcards.filter(c => db.flashcardDecks.some(d => d.id === c.deckId));
            db.estudos = db.estudos.filter(e => e.editalId !== currentEditalId);
            db.tempoEstudos = db.tempoEstudos.filter(t => t.editalId !== currentEditalId);
            db.assuntosManuais = db.assuntosManuais.filter(m => m.editalId !== currentEditalId);
            setCurrentEditalId(db.editais.length > 0 ? db.editais[0].id : null);
            apiSaveData(db); updateEditalUI(); showPage('page-estudos');
        }
    });

    document.getElementById('btn-save-new-disc')?.addEventListener('click', () => {
        const edital = getCurrentEdital(); if(!edital) return;
        const nome = document.getElementById('new-disc-name').value.trim(); const assuntosRaw = document.getElementById('new-disc-subjects').value;
        if(!nome) return alert('Digite o nome da disciplina.');
        if(edital.disciplinas.some(d => d.nome.toLowerCase() === nome.toLowerCase())) return alert('Disciplina já existe.');
        const assuntos = assuntosRaw.split(';').map(a => a.trim()).filter(a => a.length > 0);
        edital.disciplinas.push({ nome, assuntos }); apiSaveData(db);
        document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('add-disciplina-modal').classList.remove('active'); renderDisciplinas();
    });

    document.getElementById('btn-process-trilha')?.addEventListener('click', () => {
        const edital = getCurrentEdital(); if(!edital) return;
        const csv = document.getElementById('trilha-csv-input').value; if(!csv.trim()) return alert('Cole os conteúdos separados por ponto e vírgula.');
        const lines = csv.split('\n'); let added = 0;
        lines.forEach(line => {
            const parts = line.split(';');
            if(parts.length >= 3) {
                const discName = parts[0].trim(); 
                const aulaName = parts[1].trim(); 
                const assunto = parts.slice(2).join(';').trim();
                
                // Formata internamente como "Aula 01 - Assunto" para manter a integridade do banco
                const formatAssunto = `${aulaName} - ${assunto}`;
                
                let d = edital.disciplinas.find(x => x.nome.toLowerCase() === discName.toLowerCase());
                if(!d) { d = { nome: discName, assuntos: [] }; edital.disciplinas.push(d); }
                if(!d.assuntos.includes(formatAssunto)) { d.assuntos.push(formatAssunto); added++; }
            }
        });
        if(added > 0) { apiSaveData(db); renderDisciplinas(); alert(`${added} conteúdos processados com sucesso!`); }
        else alert('Nenhum conteúdo novo adicionado.');
        document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('import-trilha-modal').classList.remove('active');
    });

    // ==========================================
    // LÓGICA DE REGISTROS, CICLOS E ESTATÍSTICAS
    // ==========================================
    document.getElementById('btn-salvar-registro')?.addEventListener('click', (e) => salvarRegistro(e.target));
    document.getElementById('btn-salvar-revisao')?.addEventListener('click', (e) => salvarRevisao(e.target));

    document.getElementById('gerar-ciclo-btn')?.addEventListener('click', () => {
        const edital = getCurrentEdital(); if(!edital) return;
        edital.ciclo.metaHoras = parseInt(document.getElementById('config-meta-horas').value) || 4;
        edital.ciclo.disciplinasPorDia = parseInt(document.getElementById('ciclo-disciplinas-por-dia').value) || 3;
        let newDeck = [];
        document.querySelectorAll('.peso-input').forEach(input => {
            const disc = input.getAttribute('data-disc'); const peso = parseInt(input.value) || 0;
            edital.ciclo.pesos[disc] = peso; for(let i=0; i<peso; i++) newDeck.push(disc);
        });
        for (let i = newDeck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]]; }
        edital.ciclo.deck = newDeck; apiSaveData(db); renderCicloConfig(); alert('Novo ciclo gerado e embaralhado com sucesso!');
    });

    document.getElementById('btn-generate-pdf')?.addEventListener('click', generatePDF);
    ['filter-disciplina', 'filter-data-inicio', 'filter-data-fim'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', renderEstatisticas);
    });

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.id === 'page-estatisticas' && mutation.target.classList.contains('active')) {
                const select = document.getElementById('filter-disciplina'); 
                const edital = getCurrentEdital();
                if(select && edital) {
                    const opts = edital.disciplinas.map(d => `<option value="${d.nome}">${d.nome}</option>`).join(''); 
                    select.innerHTML = '<option value="todas">Todas</option>' + opts;
                }
                renderEstatisticas();
            }
        });
    });
    document.querySelectorAll('.page').forEach(p => observer.observe(p, { attributes: true, attributeFilter: ['class'] }));

    // ==========================================
    // LÓGICA DE FLASHCARDS
    // ==========================================
    document.getElementById('btn-open-scheduled')?.addEventListener('click', () => {
        renderScheduledCards(); document.getElementById('modal-backdrop').classList.add('active'); document.getElementById('scheduled-cards-modal').classList.add('active');
    });
    document.getElementById('btn-save-edit-card')?.addEventListener('click', saveEditedCard);

    document.getElementById('btn-open-new-deck')?.addEventListener('click', () => {
        document.getElementById('new-deck-name').value = '';
        document.getElementById('modal-backdrop').classList.add('active'); document.getElementById('new-deck-modal').classList.add('active');
    });

    document.getElementById('btn-save-deck')?.addEventListener('click', () => {
        const name = document.getElementById('new-deck-name').value.trim(); const edital = getCurrentEdital();
        if(!edital) return alert("Selecione um edital primeiro."); if(!name) return alert('Digite o nome do deck');
        db.flashcardDecks.push({ id: Date.now().toString(), name, editalId: edital.id });
        apiSaveData(db); document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('new-deck-modal').classList.remove('active'); renderFlashcardsDashboard();
    });

    document.getElementById('btn-open-new-card')?.addEventListener('click', () => {
        const edital = getCurrentEdital(); if(!edital) return alert('Selecione um edital primeiro!');
        const editalDecks = db.flashcardDecks.filter(d => d.editalId === edital.id);
        if(editalDecks.length === 0) return alert('Crie um deck neste edital primeiro!');
        document.getElementById('new-card-front').value = ''; document.getElementById('new-card-back').value = '';
        document.getElementById('modal-backdrop').classList.add('active'); document.getElementById('new-card-modal').classList.add('active');
    });

    document.getElementById('btn-save-card')?.addEventListener('click', () => {
        const deckId = document.getElementById('new-card-deck-select').value;
        const front = document.getElementById('new-card-front').value.trim(); const back = document.getElementById('new-card-back').value.trim();
        if(!deckId) return alert("Selecione um deck válido."); if(!front || !back) return alert("Preencha frente e verso.");
        db.flashcards.push({ id: Date.now().toString(), deckId, front, back, status: 'new', stepIndex: 0, interval: 0, ease: 2.5, reps: 0, nextReview: getTodayDate(), nextReviewTime: null });
        apiSaveData(db); document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('new-card-modal').classList.remove('active'); renderFlashcardsDashboard();
    });

    document.getElementById('btn-open-import-cards')?.addEventListener('click', () => {
        const edital = getCurrentEdital(); if(!edital) return alert('Selecione um edital!');
        const editalDecks = db.flashcardDecks.filter(d => d.editalId === edital.id);
        if(editalDecks.length === 0) return alert('Crie um deck primeiro!');
        document.getElementById('import-cards-input').value = '';
        document.getElementById('modal-backdrop').classList.add('active'); document.getElementById('import-cards-modal').classList.add('active');
    });

    document.getElementById('btn-save-imported-cards')?.addEventListener('click', () => {
        const deckId = document.getElementById('import-card-deck-select').value; const text = document.getElementById('import-cards-input').value.trim();
        if(!deckId) return alert("Selecione um deck válido."); if(!text) return alert("Cole os cards no formato Frente;Verso");
        const lines = text.split('\n'); let count = 0;
        lines.forEach(line => {
            const parts = line.split(';');
            if(parts.length >= 2) {
                const front = parts[0].trim(); const back = parts.slice(1).join(';').trim();
                if(front && back) { db.flashcards.push({ id: Date.now().toString() + Math.random().toString().substr(2, 5), deckId, front, back, status: 'new', stepIndex: 0, interval: 0, ease: 2.5, reps: 0, nextReview: getTodayDate(), nextReviewTime: null }); count++; }
            }
        });
        if(count > 0) { apiSaveData(db); document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('import-cards-modal').classList.remove('active'); renderFlashcardsDashboard(); alert(`${count} cards importados com sucesso!`); }
        else alert("Nenhum card válido encontrado.");
    });

    document.getElementById('btn-study-all-cards')?.addEventListener('click', () => {
        const edital = getCurrentEdital(); if (!edital) return alert("Selecione um edital.");
        const editalDecksIds = db.flashcardDecks.filter(d => d.editalId === edital.id).map(d => d.id);
        if(editalDecksIds.length === 0) return alert("Nenhum deck neste edital.");
        startFlashcardsStudy(null, editalDecksIds);
    });

    document.getElementById('btn-exit-study')?.addEventListener('click', async () => {
        await finishFlashcardSession();
        document.getElementById('flashcards-study-area').style.display = 'none'; document.getElementById('flashcards-dashboard').style.display = 'block';
        renderFlashcardsDashboard();
    });

    document.getElementById('fc-container')?.addEventListener('click', function(e) {
        if (document.getElementById('fc-front-text').classList.contains('fc-waiting')) return;
        if (e.target.closest('.fc-actions')) return;

        this.classList.toggle('flipped');
        if(this.classList.contains('flipped')) {
            document.getElementById('fc-actions').style.display = 'flex';
            document.querySelector('.fc-hint').style.display = 'none';
        }
    });

    document.getElementById('btn-close-edit-modal')?.addEventListener('click', () => {
        document.getElementById('edit-card-modal').classList.remove('active');
        document.getElementById('manage-cards-modal').classList.add('active');
    });

    // ==========================================
    // UTILS E PERFIL
    // ==========================================
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
        const t = document.body.dataset.theme==='dark'?'light':'dark';
        document.body.dataset.theme=t; localStorage.setItem('studyAppTheme', t);
    });

    document.querySelectorAll('.modal-close-btn').forEach(b => b.addEventListener('click', () => { 
        if (b.id === 'btn-close-edit-modal') return; 
        document.getElementById('modal-backdrop').classList.remove('active'); document.querySelectorAll('.modal').forEach(m => m.classList.remove('active')); 
    }));

    document.getElementById('btn-profile')?.addEventListener('click', () => {
        document.getElementById('profile-name').value = currentUser.name || '';
        document.getElementById('profile-email').value = currentUser.email || '';
        document.getElementById('profile-password').value = '';
        document.getElementById('modal-backdrop').classList.add('active');
        document.getElementById('profile-modal').classList.add('active');
    });

    document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
        const name = document.getElementById('profile-name').value;
        const password = document.getElementById('profile-password').value;
        try {
            const res = await fetch(`${API_URL}/auth/profile`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
                body: JSON.stringify({ name, password: password || undefined })
            });
            const data = await res.json();
            if(res.ok) {
                setCurrentUser(data.user); alert("Perfil atualizado!");
                document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('profile-modal').classList.remove('active');
            } else alert("Erro: " + data.msg);
        } catch(e) { alert("Erro de conexão"); }
    });

    initTimerDOM(openRegistroModal);
    checkAuth();
});