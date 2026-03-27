document.addEventListener('DOMContentLoaded', () => {

    const styleSheet = document.createElement("style");
    styleSheet.innerText = `
        .btn-edit { color: var(--text-light); transition: all 0.2s; }
        .btn-edit:hover { color: var(--primary-color); background-color: rgba(37, 99, 235, 0.1); transform: scale(1.1); }
        .icon-action-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 1.1rem; }
        .icon-action-btn:hover { background-color: rgba(0,0,0,0.05); }
        
        .anki-counts { display: flex; gap: 12px; font-weight: 700; font-size: 1rem; border-bottom: 2px solid var(--border-color); padding-bottom: 4px;}
        .anki-new { color: #3b82f6; }   
        .anki-learn { color: #ef4444; } 
        .anki-review { color: #10b981; }
        
        .fc-wait-screen { text-align: center; padding: 40px 20px; color: var(--text-color); display:flex; flex-direction:column; align-items:center; gap:15px; }
        .fc-wait-time { font-size: 2.5rem; font-weight: bold; color: var(--primary-color); font-variant-numeric: tabular-nums;}
    `;
    document.head.appendChild(styleSheet);

    const API_URL = window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1')
        ? 'http://localhost:5000/api'
        : '/api';
        
    let authToken = localStorage.getItem('token');
    let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    
    let isSaving = false;

    let db = {
        editais: [],
        estudos: [],       
        tempoEstudos: [],  
        assuntosManuais: [],
        flashcardDecks: [], 
        flashcards: []      
    };

    let currentEditalId = localStorage.getItem('lastEditalId') || null;
    let charts = { acertos: null, tempo: null, cobertura: null, streak: null };
    const audioAlarm = document.getElementById('timer-sound');
    
    let isLegacyRegistration = false;
    
    let timer = {
        interval: null, running: false, mode: 'pomodoro', phase: 'focus',
        seconds: 1500, accumulated: 0, settings: { focus: 25, short: 5, long: 15 }
    };

    let currentStudySessionCards = [];
    let currentFlashcard = null;
    let currentStudyDeckId = null;
    let waitTimerInterval = null;
    
    let fcSessionStartTime = null;
    let fcSessionReviewed = 0;
    let fcSessionCorrect = 0;
    
    let currentManageDeckId = null;

    const authScreen = document.getElementById('auth-screen');
    const sidebar = document.getElementById('sidebar');
    const mainContainer = document.querySelector('.container');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const modalBackdrop = document.getElementById('modal-backdrop');
    const pages = document.querySelectorAll('.page');
    const navLinks = document.querySelectorAll('.nav-link');
    const editalSelector = document.getElementById('edital-selector');
    const navEditalSelector = document.getElementById('navbar-edital-select');
    
    const escapeQuotes = (str) => {
        if (!str) return '';
        return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    };

    const checkAuth = () => {
        if(authToken) {
            authScreen.style.display = 'none';
            sidebar.style.display = 'flex';
            if(mobileMenuBtn) mobileMenuBtn.style.display = ''; 
            if(mainContainer) mainContainer.style.display = 'block';
            
            const isAdmin = (currentUser && currentUser.role === 'admin');
            const btnAdmin = document.getElementById('btn-admin-panel');
            if (btnAdmin) btnAdmin.style.display = isAdmin ? 'flex' : 'none';

            loadDataFromCloud();
        } else {
            authScreen.style.display = 'flex';
            sidebar.style.display = 'none';
            if(mobileMenuBtn) mobileMenuBtn.style.display = 'none'; 
            if(mainContainer) mainContainer.style.display = 'none';
        }
    };

    const handleAuth = async (endpoint) => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        if(!email || !password) return alert("Preencha email e senha!");
        
        try {
            const res = await fetch(`${API_URL}/auth/${endpoint}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            
            if(res.ok) {
                authToken = data.token;
                currentUser = data.user;
                localStorage.setItem('token', authToken);
                localStorage.setItem('user', JSON.stringify(currentUser));
                checkAuth();
            } else {
                alert(data.msg || "Erro ao conectar.");
            }
        } catch(err) { console.error(err); alert("Erro de conexão."); }
    };

    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) btnLogin.addEventListener('click', () => handleAuth('login'));
    
    const performLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('lastEditalId');
        location.reload();
    };

    document.getElementById('btn-logout').addEventListener('click', performLogout);

    const loadDataFromCloud = async () => {
        if(!authToken) return;
        try {
            const res = await fetch(`${API_URL}/data`, { headers: { 'x-auth-token': authToken } });
            
            if(res.ok) {
                const cloudData = await res.json();
                
                if (cloudData.disciplinas && cloudData.disciplinas.length > 0 && (!cloudData.editais || cloudData.editais.length === 0)) {
                    const defaultEdital = {
                        id: 'default-edital',
                        nome: 'Meu Edital',
                        disciplinas: cloudData.disciplinas || [],
                        ciclo: cloudData.ciclo || { deck: [], disciplinasPorDia: 3, metaHoras: 4 }
                    };
                    cloudData.editais = [defaultEdital];
                    delete cloudData.disciplinas;
                    delete cloudData.ciclo;
                    db = { ...db, ...cloudData };
                    saveData();
                } else {
                    db = { ...db, ...cloudData };
                }

                if (!db.editais) db.editais = [];
                if (!db.estudos) db.estudos = [];
                if (!db.tempoEstudos) db.tempoEstudos = [];
                if (!db.assuntosManuais) db.assuntosManuais = [];
                if (!db.flashcardDecks) db.flashcardDecks = [];
                if (!db.flashcards) db.flashcards = [];
                
                let needSave = false;
                if (db.editais.length > 0) {
                    db.flashcardDecks.forEach(d => {
                        if (!d.editalId) { d.editalId = db.editais[0].id; needSave = true; }
                    });
                }
                db.flashcards.forEach(c => {
                    if (!c.status || c.status === 'graduated') {
                        c.status = (c.reps && c.reps > 0) ? 'review' : 'new';
                        needSave = true;
                    }
                });
                if(needSave) saveData();

                if (db.editais.length > 0) {
                    if (!currentEditalId || !db.editais.find(e => e.id === currentEditalId)) {
                        currentEditalId = db.editais[0].id;
                        localStorage.setItem('lastEditalId', currentEditalId);
                    }
                } else {
                    currentEditalId = null;
                    localStorage.removeItem('lastEditalId');
                }

                updateEditalUI();
                renderHomePage();
                
                const theme = localStorage.getItem('studyAppTheme') || 'light';
                document.body.dataset.theme = theme;
            } else if(res.status === 401) {
                localStorage.clear();
                location.reload();
            }
        } catch (err) { console.error("Erro loadData", err); }
    };

    const saveData = async () => {
        if(!authToken) return;
        try {
            const res = await fetch(`${API_URL}/data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
                body: JSON.stringify(db)
            });
            if (!res.ok) throw new Error("Falha na sincronização com o servidor.");
        } catch (err) { 
            console.error("Erro save", err);
            throw err; 
        }
    };

    const saveIncremental = async (payload) => {
        if(!authToken) return;
        try {
            const res = await fetch(`${API_URL}/estudos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error("Falha na sincronização parcial.");
            return await res.json();
        } catch (err) {
            console.error("Erro saveIncremental", err);
            throw err;
        }
    };

    const updateRevisionStatus = async (studyId, revIndex) => {
        if(!authToken) return;
        try {
            const res = await fetch(`${API_URL}/estudos/revisao`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
                body: JSON.stringify({ studyId, revIndex })
            });
            if (!res.ok) throw new Error("Falha ao atualizar revisão.");
            return await res.json();
        } catch (err) {
            console.error(err);
            throw err;
        }
    };

    const getCurrentEdital = () => {
        if (!currentEditalId || db.editais.length === 0) return null;
        return db.editais.find(e => e.id === currentEditalId) || null;
    };

    const getTaskNumber = (str) => {
        if (!str) return 999999;
        const match = str.match(/^T(\d+)/i); 
        return match ? parseInt(match[1]) : 999999;
    };

    const getTodayDate = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const formatDateBr = (dateStr) => {
        if(!dateStr) return "-";
        if(dateStr === 'SEM_DATA') return "Data desc.";
        const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
        const [y, m, d] = cleanDate.split('-');
        return `${d}/${m}/${y}`;
    };

    const formatDuration = (m) => `${Math.floor(m/60)}h ${m%60}m`;
    
    const addDays = (dateStr, days) => {
        if (dateStr === 'SEM_DATA') return 'SEM_DATA';
        const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
        const [y, m, d] = cleanDate.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        dateObj.setDate(dateObj.getDate() + days);
        const resY = dateObj.getFullYear();
        const resM = String(dateObj.getMonth() + 1).padStart(2, '0');
        const resD = String(dateObj.getDate()).padStart(2, '0');
        return `${resY}-${resM}-${resD}`;
    };

    const diffInDays = (date1Str, date2Str) => {
        if(!date1Str || !date2Str || date1Str === 'SEM_DATA' || date2Str === 'SEM_DATA') return 0;
        const d1 = new Date(date1Str.includes('T') ? date1Str.split('T')[0] : date1Str);
        const d2 = new Date(date2Str.includes('T') ? date2Str.split('T')[0] : date2Str);
        d1.setHours(0,0,0,0);
        d2.setHours(0,0,0,0);
        return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    };

    const updateEditalUI = () => {
        const edital = getCurrentEdital();
        
        const fillSelect = (el) => {
            if(!el) return;
            if (db.editais.length === 0) {
                el.innerHTML = '<option value="">Nenhum Edital</option>';
            } else {
                el.innerHTML = db.editais.map(e => 
                    `<option value="${e.id}" ${e.id === currentEditalId ? 'selected' : ''}>${e.nome}</option>`
                ).join('');
            }
        };

        fillSelect(editalSelector);
        fillSelect(navEditalSelector);
        
        const btnAddDisc = document.getElementById('btn-open-add-disc');
        if(btnAddDisc && edital) {
            if(edital.isTrilha) {
                btnAddDisc.innerHTML = '<i class="ph ph-clipboard-text"></i> Adicionar Trilha';
                btnAddDisc.classList.replace('btn-primary', 'btn-secondary'); 
            } else {
                btnAddDisc.innerHTML = '<i class="ph ph-plus"></i> Nova Disciplina';
                btnAddDisc.classList.replace('btn-secondary', 'btn-primary');
            }
        }
    };

    const handleEditalChange = (newId) => {
        if(!newId) return;
        currentEditalId = newId;
        localStorage.setItem('lastEditalId', currentEditalId);
        updateEditalUI();
        const activePageId = document.querySelector('.page.active').id;
        showPage(activePageId);
    };

    if(editalSelector) editalSelector.addEventListener('change', (e) => handleEditalChange(e.target.value));
    if(navEditalSelector) navEditalSelector.addEventListener('change', (e) => handleEditalChange(e.target.value));

    const btnNewEdital = document.getElementById('btn-new-edital');
    if(btnNewEdital) {
        btnNewEdital.addEventListener('click', () => {
            document.getElementById('new-edital-name').value = '';
            const chk = document.getElementById('new-edital-is-trilha');
            if(chk) chk.checked = false; 
            
            modalBackdrop.classList.add('active');
            document.getElementById('new-edital-modal').classList.add('active');
        });
    }

    const btnSaveEdital = document.getElementById('btn-save-edital');
    if(btnSaveEdital) {
        btnSaveEdital.addEventListener('click', () => {
            const nome = document.getElementById('new-edital-name').value.trim();
            const chk = document.getElementById('new-edital-is-trilha');
            const isTrilha = chk ? chk.checked : false; 
            
            if(!nome) return alert("Digite o nome.");
            
            const newEdital = {
                id: Date.now().toString(),
                nome: nome,
                isTrilha: isTrilha, 
                disciplinas: [],
                ciclo: { deck: [], disciplinasPorDia: 3, metaHoras: 4 }
            };
            
            db.editais.push(newEdital);
            currentEditalId = newEdital.id;
            localStorage.setItem('lastEditalId', currentEditalId);
            
            saveData();
            updateEditalUI();
            
            modalBackdrop.classList.remove('active');
            document.getElementById('new-edital-modal').classList.remove('active');
            showPage('page-estudos');
        });
    }

    const btnDelEdital = document.getElementById('btn-delete-edital');
    if(btnDelEdital) {
        btnDelEdital.addEventListener('click', () => {
            const edital = getCurrentEdital();
            if(!edital) return;
            
            if(confirm(`Tem certeza que deseja apagar o edital "${edital.nome}" e todas as suas disciplinas?`)) {
                db.editais = db.editais.filter(e => e.id !== currentEditalId);
                currentEditalId = db.editais.length > 0 ? db.editais[0].id : null;
                
                if(currentEditalId) localStorage.setItem('lastEditalId', currentEditalId);
                else localStorage.removeItem('lastEditalId');
                
                saveData();
                updateEditalUI();
                showPage('page-estudos');
            }
        });
    }

    const showPage = (pageId) => {
        pages.forEach(p => p.classList.remove('active'));
        navLinks.forEach(l => {
            l.classList.remove('active');
            if (l.dataset.page === pageId) l.classList.add('active');
        });
        const targetPage = document.getElementById(pageId);
        if(targetPage) targetPage.classList.add('active');

        if(window.innerWidth <= 1024) sidebar.classList.remove('show');

        updateEditalUI();

        if (pageId === 'page-home') renderHomePage();
        if (pageId === 'page-estudos') renderDisciplinas();
        if (pageId === 'page-estatisticas') renderEstatisticas();
        if (pageId === 'page-ciclo') renderCicloConfig();
        if (pageId === 'page-flashcards') renderFlashcardsDashboard();
    };

    navLinks.forEach(l => l.addEventListener('click', (e) => { 
        if(l.dataset.page) {
            e.preventDefault(); 
            showPage(l.dataset.page);
        }
    }));
    
    if(sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            if (window.innerWidth <= 1024) {
                sidebar.classList.remove('show');
            } else {
                sidebar.classList.toggle('collapsed');
                mainContainer.classList.toggle('collapsed');
            }
        });
    }

    if(mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.add('show');
        });
    }

    const filterStudiesByEdital = (list) => {
        const edital = getCurrentEdital();
        if(!edital) return [];
        const discNames = edital.disciplinas.map(d => d.nome);
        return list.filter(item => {
            if (item.editalId) return item.editalId === edital.id;
            return discNames.includes(item.disciplina);
        });
    };

    const renderHomePage = () => {
        const edital = getCurrentEdital();
        updateSummaries(edital);
        
        if (!edital) {
            document.getElementById('ciclo-hoje-list').innerHTML = '<p class="empty-state">Selecione ou crie um edital para começar.</p>';
            document.getElementById('revisoes-pendentes-list').innerHTML = '<p class="empty-state">-</p>';
            document.getElementById('dashboard-table-body').innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Nenhum edital ativo.</td></tr>';
            renderHeatmap(); 
            calculateStreakStats(); 
            return;
        }

        renderCicloFila(edital); 
        renderRevisoesPendentes(edital);
        renderHeatmap(); 
        calculateStreakStats(); 
        renderDashboardTable(edital);
        renderEditalGlobalProgress(edital); 
    };

    const renderEditalGlobalProgress = (edital) => {
        const elBar = document.getElementById('dash-edital-progress');
        const elPerc = document.getElementById('dash-edital-perc');
        if (!elBar || !elPerc) return;

        if (!edital) {
            elBar.style.width = '0%';
            elPerc.textContent = '0%';
            return;
        }

        let totalAssuntos = 0;
        let concluidos = 0;

        edital.disciplinas.forEach(d => {
            totalAssuntos += d.assuntos.length;
            const concluidosDisc = db.assuntosManuais.filter(m => 
                m.disciplina === d.nome && 
                m.assunto && 
                d.assuntos.includes(m.assunto) && 
                (!m.editalId || m.editalId === edital.id)
            ).length;
            concluidos += concluidosDisc;
        });

        const percentual = totalAssuntos > 0 ? Math.round((concluidos / totalAssuntos) * 100) : 0;
        elBar.style.width = `${percentual}%`;
        elPerc.textContent = `${percentual}%`;
    };

    const updateSummaries = (edital) => {
        const today = getTodayDate();
        const metaHoras = (edital && edital.ciclo && edital.ciclo.metaHoras) ? edital.ciclo.metaHoras : 4;
        
        if (!edital) {
            document.getElementById('dash-meta-horas').textContent = `0h 0m / ${metaHoras}h`;
            document.getElementById('dash-tempo').textContent = "0h 0m";
            document.getElementById('dash-acertos').textContent = "-";
            document.getElementById('dash-revisoes').textContent = "0";
            return;
        }

        const temposEdital = filterStudiesByEdital(db.tempoEstudos);
        const minsHoje = temposEdital.filter(t => {
            if(t.data === 'SEM_DATA') return false;
            const tData = t.data.includes('T') ? t.data.split('T')[0] : t.data;
            return tData === today;
        }).reduce((acc, c) => acc + c.tempoMinutos, 0);

        const h = Math.floor(minsHoje / 60); const m = minsHoje % 60;
        document.getElementById('dash-meta-horas').textContent = `${h}h ${m}m / ${metaHoras}h`;
        document.getElementById('dash-tempo').textContent = formatDuration(minsHoje);

        const estudosEdital = filterStudiesByEdital(db.estudos);
        let q = 0, a = 0;
        estudosEdital.filter(e => {
            if(e.data === 'SEM_DATA') return false;
            const eData = e.data.includes('T') ? e.data.split('T')[0] : e.data;
            // Ignora Flashcards na soma de questões dos cards do dashboard
            return eData === today && e.disciplina !== 'Flashcards';
        }).forEach(e => { q += e.total; a += e.acertos; });
        
        const elAcertos = document.getElementById('dash-acertos');
        elAcertos.textContent = q > 0 ? `${Math.round((a/q)*100)}%` : '-';

        let pends = 0;
        estudosEdital.forEach(e => {
            if(e.revisoes) e.revisoes.forEach(r => { 
                if(r.data === 'SEM_DATA') return;
                const rData = r.data.includes('T') ? r.data.split('T')[0] : r.data;
                if(!r.concluida && rData <= today) pends++; 
            });
        });
        document.getElementById('dash-revisoes').textContent = pends;
    };

    const calculateStreakStats = () => {
        const rawDates = new Set([ 
            ...db.estudos.filter(e => e.data !== 'SEM_DATA').map(e => e.data), 
            ...db.tempoEstudos.filter(t => t.data !== 'SEM_DATA').map(t => t.data) 
        ]);
        const sanitizedDates = new Set();
        rawDates.forEach(d => { if(d) sanitizedDates.add(d.includes('T') ? d.split('T')[0] : d); });
        const sortedDates = [...sanitizedDates].sort();
        
        let maxStreak = sortedDates.length > 0 ? 1 : 0;
        let currentStreak = 0;
        
        if (sortedDates.length > 0) {
            let currentRun = 1;
            for (let i = 1; i < sortedDates.length; i++) {
                const diff = diffInDays(sortedDates[i-1], sortedDates[i]);
                if (diff === 1) currentRun++;
                else { if (currentRun > maxStreak) maxStreak = currentRun; currentRun = 1; }
            }
            if (currentRun > maxStreak) maxStreak = currentRun;

            const today = getTodayDate();
            const yesterday = addDays(today, -1);
            const lastStudyDate = sortedDates[sortedDates.length - 1];

            if (lastStudyDate === today || lastStudyDate === yesterday) {
                currentStreak = 1;
                let checkDateStr = lastStudyDate;
                for (let i = sortedDates.length - 2; i >= 0; i--) {
                    const prevDate = sortedDates[i];
                    if (diffInDays(prevDate, checkDateStr) === 1) { currentStreak++; checkDateStr = prevDate; } 
                    else break;
                }
            }
        }
        
        const elStreakNav = document.getElementById('nav-streak-count');
        if(elStreakNav) elStreakNav.textContent = currentStreak;
        const elStreakVal = document.getElementById('current-streak-val');
        if(elStreakVal) elStreakVal.textContent = currentStreak;
        const elStreakRec = document.getElementById('record-streak-val');
        if(elStreakRec) elStreakRec.textContent = maxStreak;

        const estudosEdital = filterStudiesByEdital(db.estudos);
        const temposEdital = filterStudiesByEdital(db.tempoEstudos);

        const totalMins = temposEdital.reduce((acc, t) => acc + (Number(t.tempoMinutos) || 0), 0);
        const elTotalTime = document.getElementById('streak-total-time');
        if (elTotalTime) elTotalTime.textContent = formatDuration(totalMins);

        let totalQ = 0, totalA = 0;
        estudosEdital.forEach(e => { 
            // Ignora Flashcards para não sujar o gráfico de questões
            if (e.disciplina !== 'Flashcards') {
                totalQ += (Number(e.total) || 0); 
                totalA += (Number(e.acertos) || 0); 
            }
        });
        
        let totalE = totalQ - totalA;
        let perc = totalQ > 0 ? Math.round((totalA / totalQ) * 100) : 0;

        const elTotalQ = document.getElementById('streak-total-q');
        if (elTotalQ) elTotalQ.textContent = totalQ;

        const elPerc = document.getElementById('streak-chart-perc');
        if (elPerc) elPerc.textContent = perc + '%';

        if (charts.streak) charts.streak.destroy();
        const ctxStreak = document.getElementById('streak-chart');
        if (ctxStreak) {
            charts.streak = new Chart(ctxStreak, {
                type: 'doughnut',
                data: {
                    labels: ['Acertos', 'Erros'],
                    datasets: [{
                        data: totalQ > 0 ? [totalA, totalE] : [1],
                        backgroundColor: totalQ > 0 ? ['#10b981', '#ef4444'] : ['#e2e8f0'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '75%',
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: totalQ > 0 }
                    }
                }
            });
        }
    };

    const renderHeatmap = () => {
        const container = document.getElementById('heatmap-container');
        if (!container) return; container.innerHTML = '';
        
        const dataMap = {};
        db.tempoEstudos.forEach(t => { 
            if(t.data === 'SEM_DATA') return;
            const d = t.data.includes('T') ? t.data.split('T')[0] : t.data;
            if(!dataMap[d]) dataMap[d] = { minutes: 0, count: 0 };
            dataMap[d].minutes += t.tempoMinutos;
            dataMap[d].count += 1;
        });
        
        const todayStr = getTodayDate();
        for (let i = 29; i >= 0; i--) {
            const dateStr = addDays(todayStr, -i);
            const data = dataMap[dateStr] || { minutes: 0, count: 0 };
            const statusClass = (data.minutes > 0 || data.count > 0) ? 'studied' : 'missed';
            
            const square = document.createElement('div');
            square.className = `heatmap-square ${statusClass}`;
            square.title = `${formatDateBr(dateStr)}: ${data.minutes} min`;
            container.appendChild(square);
        }
    };

    const renderDashboardTable = (edital) => {
        const tbody = document.getElementById('dashboard-table-body');
        if (!tbody) return; tbody.innerHTML = '';
        
        if (!edital || edital.disciplinas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-light)">Nenhuma disciplina neste edital.</td></tr>';
            return;
        }
        
        const estudosFiltrados = filterStudiesByEdital(db.estudos);
        const temposFiltrados = filterStudiesByEdital(db.tempoEstudos);

        edital.disciplinas.forEach(d => {
            const studies = estudosFiltrados.filter(e => e.disciplina === d.nome);
            const times = temposFiltrados.filter(t => t.disciplina === d.nome);
            
            const totalQ = studies.reduce((acc, e) => acc + e.total, 0);
            const totalA = studies.reduce((acc, e) => acc + e.acertos, 0);
            const totalE = totalQ - totalA;
            const perc = totalQ > 0 ? Math.round((totalA / totalQ) * 100) : 0;
            
            const totalMins = times.reduce((acc, t) => acc + (Number(t.tempoMinutos) || 0), 0);
            
            let color = 'var(--text-color)';
            if (totalQ > 0) {
                if (perc >= 80) color = 'var(--success-color)';
                else if (perc < 50) color = 'var(--danger-color)';
                else color = 'var(--warning-color)';
            }
            tbody.innerHTML += `<tr><td>${d.nome}</td><td>${totalQ}</td><td style="color:var(--success-color)">${totalA}</td><td style="color:var(--danger-color)">${totalE}</td><td style="font-weight:600; color:${color}">${perc}%</td><td>${formatDuration(totalMins)}</td></tr>`;
        });
    };

    const renderCicloFila = (edital) => {
        const container = document.getElementById('ciclo-hoje-list');
        if(!edital || !edital.ciclo) {
            container.innerHTML = '<p class="empty-state">Sem edital ativo.</p>';
            return;
        }
        
        const deck = edital.ciclo.deck || [];
        const limit = edital.ciclo.disciplinasPorDia || 3;
        
        if (deck.length === 0) { 
            container.innerHTML = '<p class="empty-state">Ciclo vazio. Configure na aba Ciclo.</p>'; return; 
        }
        
        const visibleItems = deck.slice(0, limit);
        container.innerHTML = visibleItems.map((disc, index) => {
            const today = getTodayDate();
            const studiedToday = db.tempoEstudos.some(t => {
                if(t.data === 'SEM_DATA') return false;
                const tData = t.data.includes('T') ? t.data.split('T')[0] : t.data;
                return tData === today && t.disciplina === disc && t.tipo !== 'revisao' && (!t.editalId || t.editalId === edital.id);
            });
            const statusIcon = studiedToday ? '<i class="ph ph-check-circle" style="color:var(--success-color)"></i>' : '<i class="ph ph-books"></i>';
            
            let sugestaoAssunto = "Todos concluídos!";
            const dObj = edital.disciplinas.find(d => d.nome === disc);
            
            if (dObj && dObj.assuntos.length > 0) {
                const assuntosPendentes = dObj.assuntos.filter(a => {
                     return !db.assuntosManuais.some(m => 
                        m.disciplina === disc && 
                        m.assunto === a && 
                        (!m.editalId || m.editalId === edital.id)
                     );
                });

                if (assuntosPendentes.length > 0) {
                    if (edital.isTrilha) {
                        assuntosPendentes.sort((a, b) => getTaskNumber(a) - getTaskNumber(b));
                    }
                    sugestaoAssunto = assuntosPendentes[0];
                }
            } else if (dObj && dObj.assuntos.length === 0) {
                sugestaoAssunto = "Sem assuntos cadastrados";
            }

            const safeDisc = escapeQuotes(disc);
            const safeAssunto = (sugestaoAssunto !== "Todos concluídos!" && sugestaoAssunto !== "Sem assuntos cadastrados") 
                ? escapeQuotes(sugestaoAssunto) 
                : '';

            return `
            <div class="ciclo-item-card">
                <div class="ciclo-info">
                    <h4>${statusIcon} ${disc}</h4>
                    <div style="font-size:0.85rem; color:var(--text-light); margin-left:24px; display:flex; align-items:center; gap:5px;">
                        <i class="ph ph-arrow-elbow-down-right"></i> 
                        <strong style="color:var(--primary-color)">${sugestaoAssunto}</strong>
                    </div>
                </div>
                <div class="ciclo-actions">
                    <button class="action-btn btn-manual-action" onclick="openRegistroModal('${safeDisc}', '${safeAssunto}')">
                        <span><i class="ph ph-pencil-simple"></i></span> Registrar
                    </button>
                </div>
            </div>`;
        }).join('');
    };

    const rotateCycle = (disc) => {
        const edital = getCurrentEdital();
        if(!edital) return;
        const deck = edital.ciclo.deck; 
        const idx = deck.indexOf(disc);
        if (idx > -1) { deck.splice(idx, 1); deck.push(disc); }
    };

    const renderRevisoesPendentes = (edital) => {
        const list = document.getElementById('revisoes-pendentes-list');
        if(!edital) return;
        const today = getTodayDate();
        const estudosEdital = filterStudiesByEdital(db.estudos);
        
        let html = '';
        estudosEdital.forEach(e => {
            if(e.revisoes) e.revisoes.forEach((r, idx) => {
                if(r.data === 'SEM_DATA') return;
                const rData = r.data.includes('T') ? r.data.split('T')[0] : r.data;
                if(!r.concluida && rData <= today) {
                    
                    const infoIntervalo = e.intervalo 
                        ? `<div style="font-size:0.8rem; color:var(--primary-color); margin-top:2px;"><i class="ph ph-bookmark-simple"></i> ${e.intervalo}</div>` 
                        : '';

                    html += `<div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid var(--border-color); align-items:center;">
                        <div>
                            <strong>${e.disciplina}</strong><br>
                            <small style="color:var(--text-light)">${e.assunto} (${idx===0?'1d':idx===1?'7d':'30d'})</small>
                            ${infoIntervalo}
                        </div>
                        <button class="btn-success btn-sm" onclick="openRevisaoModal('${e.id}', ${idx})"><i class="ph ph-check"></i></button>
                    </div>`;
                }
            });
        });
        list.innerHTML = html || '<p class="empty-state">Tudo em dia!</p>';
    };

    const getCardsForDeck = (deckId) => {
        return db.flashcards.filter(c => c.deckId === deckId);
    };

    const getDueCardsToday = (deckId = null, editalDecksIds = null) => {
        const today = getTodayDate();
        return db.flashcards.filter(c => {
            if (deckId && c.deckId !== deckId) return false;
            if (!deckId && editalDecksIds && !editalDecksIds.includes(c.deckId)) return false;

            if (c.status === 'review') {
                return !c.nextReview || c.nextReview <= today;
            }
            return !c.nextReview || c.nextReview <= today;
        });
    };

    const renderFlashcardsDashboard = () => {
        const list = document.getElementById('decks-list');
        list.innerHTML = '';
        
        const edital = getCurrentEdital();
        if (!edital) {
            list.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">Selecione ou crie um edital para ver seus flashcards.</div>';
            document.getElementById('new-card-deck-select').innerHTML = '';
            document.getElementById('import-card-deck-select').innerHTML = '';
            return;
        }

        const editalDecks = db.flashcardDecks.filter(d => d.editalId === edital.id);

        if (editalDecks.length === 0) {
            list.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">Nenhum deck criado para este edital ainda.</div>';
            document.getElementById('new-card-deck-select').innerHTML = '';
            document.getElementById('import-card-deck-select').innerHTML = '';
            return;
        }

        editalDecks.forEach(deck => {
            const allCards = getCardsForDeck(deck.id);
            const dueCards = getDueCardsToday(deck.id, null);

            const countNew = dueCards.filter(c => c.status === 'new').length;
            const countLearn = dueCards.filter(c => c.status === 'learning').length;
            const countReview = dueCards.filter(c => c.status === 'review').length;

            const countsHtml = dueCards.length > 0 
                ? `<div class="anki-counts" style="border:none; padding:0; justify-content:flex-start; margin-top:5px;">
                     <span class="anki-new" title="Novos">${countNew}</span>
                     <span class="anki-learn" title="Aprendizagem">${countLearn}</span>
                     <span class="anki-review" title="Revisão">${countReview}</span>
                   </div>` 
                : `<small style="color:var(--text-light)">Tudo em dia!</small>`;

            list.innerHTML += `
            <div class="card deck-item" style="margin-bottom:0; flex-direction: row; flex-wrap:wrap; gap:15px;">
                <div class="deck-info" style="flex:1; min-width:200px;">
                    <strong>${deck.name}</strong>
                    ${countsHtml}
                </div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <button class="btn-primary btn-sm" onclick="startFlashcardsStudy('${deck.id}')" ${dueCards.length === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
                        <i class="ph ph-play"></i> Estudar
                    </button>
                    <button class="icon-btn btn-secondary" onclick="openManageCards('${deck.id}')" title="Gerir Cartões"><i class="ph ph-list"></i></button>
                    <button class="icon-action-btn btn-trash" onclick="deleteDeck('${deck.id}')"><i class="ph ph-trash"></i></button>
                </div>
            </div>`;
        });

        const opts = editalDecks.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
        document.getElementById('new-card-deck-select').innerHTML = opts;
        document.getElementById('import-card-deck-select').innerHTML = opts;
    };

    window.deleteDeck = (id) => {
        if(confirm("Excluir este deck e TODOS os seus cards?")) {
            db.flashcardDecks = db.flashcardDecks.filter(d => d.id !== id);
            db.flashcards = db.flashcards.filter(c => c.deckId !== id);
            saveData();
            renderFlashcardsDashboard();
        }
    };

    document.getElementById('btn-open-new-deck').addEventListener('click', () => {
        document.getElementById('new-deck-name').value = '';
        modalBackdrop.classList.add('active');
        document.getElementById('new-deck-modal').classList.add('active');
    });

    document.getElementById('btn-save-deck').addEventListener('click', () => {
        const name = document.getElementById('new-deck-name').value.trim();
        const edital = getCurrentEdital();

        if(!edital) return alert("Selecione um edital primeiro.");
        if(!name) return alert('Digite o nome do deck');
        
        db.flashcardDecks.push({ id: Date.now().toString(), name, editalId: edital.id });
        saveData();
        modalBackdrop.classList.remove('active');
        document.getElementById('new-deck-modal').classList.remove('active');
        renderFlashcardsDashboard();
    });

    document.getElementById('btn-open-new-card').addEventListener('click', () => {
        const edital = getCurrentEdital();
        if(!edital) return alert('Selecione um edital primeiro!');
        
        const editalDecks = db.flashcardDecks.filter(d => d.editalId === edital.id);
        if(editalDecks.length === 0) return alert('Crie um deck neste edital primeiro!');
        
        document.getElementById('new-card-front').value = '';
        document.getElementById('new-card-back').value = '';
        modalBackdrop.classList.add('active');
        document.getElementById('new-card-modal').classList.add('active');
    });

    document.getElementById('btn-save-card').addEventListener('click', () => {
        const deckId = document.getElementById('new-card-deck-select').value;
        const front = document.getElementById('new-card-front').value.trim();
        const back = document.getElementById('new-card-back').value.trim();

        if(!deckId) return alert("Selecione um deck válido.");
        if(!front || !back) return alert("Preencha frente e verso.");

        db.flashcards.push({
            id: Date.now().toString(),
            deckId,
            front,
            back,
            status: 'new',
            stepIndex: 0,
            interval: 0,
            ease: 2.5,
            reps: 0,
            nextReview: getTodayDate(),
            nextReviewTime: null
        });

        saveData();
        modalBackdrop.classList.remove('active');
        document.getElementById('new-card-modal').classList.remove('active');
        renderFlashcardsDashboard();
    });

    document.getElementById('btn-open-import-cards').addEventListener('click', () => {
        const edital = getCurrentEdital();
        if(!edital) return alert('Selecione um edital primeiro!');
        
        const editalDecks = db.flashcardDecks.filter(d => d.editalId === edital.id);
        if(editalDecks.length === 0) return alert('Crie um deck neste edital primeiro!');
        
        document.getElementById('import-cards-input').value = '';
        modalBackdrop.classList.add('active');
        document.getElementById('import-cards-modal').classList.add('active');
    });

    document.getElementById('btn-save-imported-cards').addEventListener('click', () => {
        const deckId = document.getElementById('import-card-deck-select').value;
        const text = document.getElementById('import-cards-input').value.trim();
        
        if(!deckId) return alert("Selecione um deck válido.");
        if(!text) return alert("Cole os cards no formato Frente;Verso");

        const lines = text.split('\n');
        let count = 0;

        lines.forEach(line => {
            const parts = line.split(';');
            if(parts.length >= 2) {
                const front = parts[0].trim();
                const back = parts.slice(1).join(';').trim(); 
                if(front && back) {
                    db.flashcards.push({
                        id: Date.now().toString() + Math.random().toString().substr(2, 5),
                        deckId,
                        front,
                        back,
                        status: 'new',
                        stepIndex: 0,
                        interval: 0,
                        ease: 2.5,
                        reps: 0,
                        nextReview: getTodayDate(),
                        nextReviewTime: null
                    });
                    count++;
                }
            }
        });

        if(count > 0) {
            saveData();
            modalBackdrop.classList.remove('active');
            document.getElementById('import-cards-modal').classList.remove('active');
            renderFlashcardsDashboard();
            alert(`${count} cards importados com sucesso!`);
        } else {
            alert("Nenhum card válido encontrado. Verifique o formato (Frente;Verso).");
        }
    });

    document.getElementById('btn-open-scheduled').addEventListener('click', () => {
        renderScheduledCards();
        modalBackdrop.classList.add('active');
        document.getElementById('scheduled-cards-modal').classList.add('active');
    });

    const renderScheduledCards = () => {
        const container = document.getElementById('scheduled-cards-container');
        container.innerHTML = '';

        const edital = getCurrentEdital();
        if (!edital) return;

        const today = getTodayDate();
        const editalDecksIds = db.flashcardDecks.filter(d => d.editalId === edital.id).map(d => d.id);
        const futureCards = db.flashcards.filter(c => c.nextReview && c.nextReview > today && editalDecksIds.includes(c.deckId));

        if (futureCards.length === 0) {
            container.innerHTML = '<p class="empty-state">Nenhum card agendado para dias futuros neste edital. Você está em dia!</p>';
            return;
        }

        const grouped = {};
        futureCards.forEach(c => {
            if (!grouped[c.deckId]) grouped[c.deckId] = [];
            grouped[c.deckId].push(c);
        });

        let html = '';
        for (const deckId in grouped) {
            const deck = db.flashcardDecks.find(d => d.id === deckId);
            const deckName = deck ? deck.name : 'Deck Removido';
            const cards = grouped[deckId];
            
            cards.sort((a, b) => a.nextReview.localeCompare(b.nextReview));

            html += `<div style="margin-bottom: 1.5rem;">
                <h4 style="color:var(--primary-color); border-bottom: 1px solid var(--border-color); padding-bottom: 5px; margin-bottom: 10px;">${deckName} <span style="color:var(--text-light); font-size:0.8rem; font-weight:normal;">(${cards.length} cards)</span></h4>
                <div style="display:flex; flex-direction:column; gap:8px;">`;
            
            cards.forEach(c => {
                html += `<div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.02); padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); font-size:0.9rem;">
                    <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-right:10px;" title="${c.front}">${c.front}</span>
                    <span style="font-weight:600; color:var(--warning-color); white-space:nowrap;"><i class="ph ph-calendar"></i> ${formatDateBr(c.nextReview)}</span>
                </div>`;
            });

            html += `</div></div>`;
        }

        container.innerHTML = html;
    };

    window.openManageCards = (deckId) => {
        currentManageDeckId = deckId;
        const deck = db.flashcardDecks.find(d => d.id === deckId);
        document.getElementById('manage-deck-title').textContent = deck ? deck.name : '';
        renderManageCardsList();
        modalBackdrop.classList.add('active');
        document.getElementById('manage-cards-modal').classList.add('active');
    };

    const renderManageCardsList = () => {
        const list = document.getElementById('manage-cards-list');
        const cards = db.flashcards.filter(c => c.deckId === currentManageDeckId);
        
        if(cards.length === 0) {
            list.innerHTML = '<p class="empty-state">Este deck está vazio.</p>';
            return;
        }
        
        let html = '<div style="display:flex; flex-direction:column;">';
        cards.forEach(c => {
            const statusLabel = c.status === 'new' ? 'Novo' : c.status === 'learning' ? 'Aprendizagem' : 'Graduado';
            html += `
            <div class="fc-manage-item">
                <div class="fc-manage-text">
                    <strong>F: ${c.front}</strong>
                    <span>V: ${c.back}</span>
                    <div style="font-size:0.75rem; color:var(--primary-color); margin-top:6px; font-weight:500;">
                        ${statusLabel} | Próxima rev: ${formatDateBr(c.nextReview)}
                    </div>
                </div>
                <div class="fc-manage-actions">
                    <button class="icon-action-btn btn-edit" onclick="openEditCard('${c.id}')"><i class="ph ph-pencil-simple"></i></button>
                    <button class="icon-action-btn btn-trash" onclick="deleteSingleCard('${c.id}')"><i class="ph ph-trash"></i></button>
                </div>
            </div>`;
        });
        html += '</div>';
        list.innerHTML = html;
    };

    window.deleteSingleCard = (cardId) => {
        if(confirm("Tem certeza que deseja excluir este cartão?")) {
            db.flashcards = db.flashcards.filter(c => c.id !== cardId);
            saveData();
            renderManageCardsList();
            renderFlashcardsDashboard(); 
        }
    };

    window.openEditCard = (cardId) => {
        const card = db.flashcards.find(c => c.id === cardId);
        if(!card) return;
        document.getElementById('edit-card-id').value = card.id;
        document.getElementById('edit-card-front').value = card.front;
        document.getElementById('edit-card-back').value = card.back;
        
        document.getElementById('manage-cards-modal').classList.remove('active');
        document.getElementById('edit-card-modal').classList.add('active');
    };

    document.getElementById('btn-close-edit-modal').addEventListener('click', () => {
        document.getElementById('edit-card-modal').classList.remove('active');
        document.getElementById('manage-cards-modal').classList.add('active');
    });

    document.getElementById('btn-save-edit-card').addEventListener('click', () => {
        const id = document.getElementById('edit-card-id').value;
        const front = document.getElementById('edit-card-front').value.trim();
        const back = document.getElementById('edit-card-back').value.trim();

        if(!front || !back) return alert("Preencha frente e verso.");

        const card = db.flashcards.find(c => c.id === id);
        if(card) {
            card.front = front;
            card.back = back;
            saveData();
            
            document.getElementById('edit-card-modal').classList.remove('active');
            document.getElementById('manage-cards-modal').classList.add('active');
            renderManageCardsList();
            renderFlashcardsDashboard();
        }
    });

    // FLUXO DE ESTUDO DE FLASHCARDS
    const finishFlashcardSession = async () => {
        if (fcSessionReviewed > 0 && fcSessionStartTime) {
            const elapsedMins = Math.ceil((Date.now() - fcSessionStartTime) / 60000);
            const edital = getCurrentEdital();
            const deckName = currentStudyDeckId ? db.flashcardDecks.find(d => d.id === currentStudyDeckId)?.name : 'Revisão Geral';

            const novoEstudo = {
                id: Date.now().toString() + '_fc',
                editalId: edital.id,
                data: getTodayDate(),
                disciplina: 'Flashcards', 
                assunto: deckName,
                intervalo: null,
                total: fcSessionReviewed,
                acertos: fcSessionCorrect,
                percentual: Math.round((fcSessionCorrect / fcSessionReviewed) * 100),
                tempo: elapsedMins,
                revisoes: []
            };

            const novoTempo = {
                id: Date.now().toString() + '_fc_t',
                editalId: edital.id,
                data: getTodayDate(),
                disciplina: 'Flashcards',
                assunto: deckName,
                tempoMinutos: elapsedMins,
                tipo: 'revisao'
            };

            db.estudos.push(novoEstudo);
            db.tempoEstudos.push(novoTempo);

            await saveIncremental({ estudo: novoEstudo, tempo: novoTempo });
            saveData();
            
            fcSessionReviewed = 0;
            fcSessionCorrect = 0;
            fcSessionStartTime = null;
        }
    };

    document.getElementById('btn-study-all-cards').addEventListener('click', () => {
        const edital = getCurrentEdital();
        if (!edital) return alert("Selecione um edital.");
        
        const editalDecksIds = db.flashcardDecks.filter(d => d.editalId === edital.id).map(d => d.id);
        if(editalDecksIds.length === 0) return alert("Nenhum deck neste edital.");

        startFlashcardsStudy(null, editalDecksIds);
    });

    window.startFlashcardsStudy = (deckId, fallbackEditalDecksIds = null) => {
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
        } else {
            document.getElementById('study-deck-title').textContent = "Revisão Geral";
        }

        renderNextFlashcard();
    };

    document.getElementById('btn-exit-study').addEventListener('click', async () => {
        if (waitTimerInterval) clearTimeout(waitTimerInterval);
        
        await finishFlashcardSession();
        
        document.getElementById('flashcards-study-area').style.display = 'none';
        document.getElementById('flashcards-dashboard').style.display = 'block';
        renderFlashcardsDashboard();
    });

    document.getElementById('fc-container').addEventListener('click', function(e) {
        if (document.getElementById('fc-front-text').classList.contains('fc-waiting')) return;

        if(e.target.tagName !== 'BUTTON' && !e.target.classList.contains('fc-btn')) {
            this.classList.toggle('flipped');
            if(this.classList.contains('flipped')) {
                document.getElementById('fc-actions').style.display = 'flex';
                document.querySelector('.fc-hint').style.display = 'none';
            }
        }
    });

    const STEPS = [1, 10]; // min
    const GRADUATING_IVL = 1; // dia
    const EASY_IVL = 4; // dias

    const calculateIntervalsPreview = (card) => {
        const preview = { bad: '', hard: '', good: '', easy: '', showHard: true };
        
        if (card.status === 'new' || card.status === 'learning') {
            preview.showHard = true; 
            if (card.stepIndex === 0) {
                preview.bad = '<1m';
                preview.hard = '1m'; 
                preview.good = '10m';
                preview.easy = '4d';
            } else {
                preview.bad = '<1m'; 
                preview.hard = '10m'; 
                preview.good = '1d'; 
                preview.easy = '4d';
            }
        } else {
            preview.showHard = true;
            preview.bad = '10m'; 
            
            let hardInt = Math.max(1, Math.round(card.interval * 1.2));
            let goodInt = Math.max(1, Math.round(card.interval * card.ease));
            let easyInt = Math.max(1, Math.round(card.interval * card.ease * 1.3));
            
            preview.hard = hardInt + 'd';
            preview.good = goodInt + 'd';
            preview.easy = easyInt + 'd';
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

        document.getElementById('study-cards-left').innerHTML = `
            <div class="anki-counts">
                <span class="anki-new" title="Novos (New)">${countNew}</span>
                <span class="anki-learn" title="Aprendizado (Learning)">${countLearn}</span>
                <span class="anki-review" title="A Revisar (Review)">${countReview}</span>
            </div>
        `;

        if (currentStudySessionCards.length === 0) {
            finishFlashcardSession();
            
            document.getElementById('fc-front-text').textContent = "Parabéns!";
            document.getElementById('fc-front-text').classList.remove('fc-waiting');
            document.getElementById('fc-back-text').textContent = "Você concluiu os estudos de hoje para este bloco.";
            document.getElementById('fc-actions').style.display = 'none';
            document.querySelector('.fc-hint').style.display = 'none';
            document.getElementById('fc-deck-name').textContent = "Concluído";
            currentFlashcard = null;
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

            document.getElementById('fc-container').classList.remove('flipped');
            document.getElementById('fc-actions').style.display = 'none';
            document.querySelector('.fc-hint').style.display = 'none';
            document.getElementById('fc-deck-name').textContent = "Aguarde";
            
            document.getElementById('fc-front-text').classList.add('fc-waiting');
            document.getElementById('fc-front-text').innerHTML = `
                <div class="fc-wait-screen">
                    <i class="ph ph-hourglass-high" style="font-size:3rem; color:var(--primary-color);"></i>
                    <span>Próximo card em:</span>
                    <div class="fc-wait-time">${waitMins} min</div>
                    <small style="color:var(--text-light)">Aguardando o intervalo de fixação.</small>
                </div>
            `;

            waitTimerInterval = setTimeout(renderNextFlashcard, waitMs + 500);
            currentFlashcard = null;
            return;
        }

        let nextCard = readyCards.find(c => c.status === 'learning');
        if (!nextCard) nextCard = readyCards.find(c => c.status === 'review');
        if (!nextCard) nextCard = readyCards.find(c => c.status === 'new');

        currentFlashcard = nextCard;
        
        const deckObj = db.flashcardDecks.find(d => d.id === currentFlashcard.deckId);
        document.getElementById('fc-deck-name').textContent = deckObj ? deckObj.name : "Card";

        document.getElementById('fc-front-text').classList.remove('fc-waiting');
        document.getElementById('fc-front-text').innerHTML = currentFlashcard.front;
        document.getElementById('fc-back-text').innerHTML = currentFlashcard.back;

        const previews = calculateIntervalsPreview(currentFlashcard);
        document.querySelector('.fc-bad small').textContent = previews.bad;
        
        const hardBtn = document.querySelector('.fc-hard');
        if (previews.showHard) {
            hardBtn.style.display = 'block';
            document.getElementById('lbl-hard').textContent = previews.hard;
        } else {
            hardBtn.style.display = 'none';
        }
        
        document.getElementById('lbl-good').textContent = previews.good;
        document.getElementById('lbl-easy').textContent = previews.easy;

        document.getElementById('fc-container').classList.remove('flipped');
        document.getElementById('fc-actions').style.display = 'none';
        document.querySelector('.fc-hint').style.display = 'block';
    };

    window.rateFlashcard = (quality) => {
        if (!currentFlashcard) return;

        let card = db.flashcards.find(c => c.id === currentFlashcard.id);
        if(!card) return;

        fcSessionReviewed++;
        if (quality >= 2) fcSessionCorrect++;

        const now = Date.now();
        const today = getTodayDate();

        if (!card.status) card.status = 'new';
        if (typeof card.stepIndex !== 'number') card.stepIndex = 0;
        if (typeof card.ease !== 'number') card.ease = 2.5;
        if (typeof card.interval !== 'number') card.interval = 0;

        if (card.status === 'new' || card.status === 'learning') {
            if (card.status === 'new') card.stepIndex = 0;
            card.status = 'learning';

            if (quality === 1) { 
                card.stepIndex = 0;
                card.nextReviewTime = now + (STEPS[0] * 60000);
            } 
            else if (quality === 2) { 
                card.nextReviewTime = now + (STEPS[card.stepIndex] * 60000);
            } 
            else if (quality === 3) { 
                card.stepIndex++;
                if (card.stepIndex < STEPS.length) {
                    card.nextReviewTime = now + (STEPS[card.stepIndex] * 60000);
                } else { 
                    card.status = 'review';
                    card.interval = GRADUATING_IVL;
                    card.nextReviewTime = null;
                    card.nextReview = addDays(today, card.interval);
                }
            } 
            else if (quality === 4) { 
                card.status = 'review';
                card.interval = EASY_IVL;
                card.nextReviewTime = null;
                card.nextReview = addDays(today, card.interval);
            }
        } 
        else if (card.status === 'review') { 
            if (quality === 1) { 
                card.status = 'learning';
                card.stepIndex = 1; 
                card.ease = Math.max(1.3, card.ease - 0.20);
                card.interval = 1; 
                card.nextReviewTime = now + (10 * 60000); 
            } else {
                card.reps++;
                if (quality === 2) { 
                    card.ease = Math.max(1.3, card.ease - 0.15);
                    card.interval = Math.max(1, Math.round(card.interval * 1.2));
                } else if (quality === 3) { 
                    card.interval = Math.max(1, Math.round(card.interval * card.ease));
                } else if (quality === 4) { 
                    card.ease += 0.15;
                    card.interval = Math.max(1, Math.round(card.interval * card.ease * 1.3));
                }
                card.nextReviewTime = null;
                card.nextReview = addDays(today, card.interval);
            }
        }

        saveData();
        renderNextFlashcard();
    };

    // ===== FIM FLASHCARDS =====

    window.openRevisaoModal = (id, idx) => {
        const e = db.estudos.find(x => x.id === id);
        if (!e) return;
        document.getElementById('rev-id').value = id;
        document.getElementById('rev-idx').value = idx;
        
        const textoIntervalo = e.intervalo ? ` (Faixa: ${e.intervalo})` : '';
        document.getElementById('rev-modal-assunto').textContent = `${e.disciplina} - ${e.assunto}${textoIntervalo}`;
        
        document.getElementById('rev-tempo').value = '';
        document.getElementById('rev-questoes').value = '';
        document.getElementById('rev-acertos').value = '';
        modalBackdrop.classList.add('active');
        document.getElementById('revisao-modal').classList.add('active');
    };

    const btnSalvarRev = document.getElementById('btn-salvar-revisao');
    if(btnSalvarRev) btnSalvarRev.addEventListener('click', async () => {
        if(isSaving) return;
        isSaving = true;
        
        const btn = btnSalvarRev;
        const originalText = btn.textContent;
        btn.textContent = "Salvando...";
        btn.disabled = true;

        try {
            const id = document.getElementById('rev-id').value;
            const idx = parseInt(document.getElementById('rev-idx').value);
            const tempo = parseInt(document.getElementById('rev-tempo').value) || 0;
            const questoes = parseInt(document.getElementById('rev-questoes').value) || 0;
            const acertos = parseInt(document.getElementById('rev-acertos').value) || 0;
            
            const originalStudy = db.estudos.find(x => x.id === id);
            if (originalStudy && originalStudy.revisoes[idx]) {
                originalStudy.revisoes[idx].concluida = true;
                
                const editalIdRef = originalStudy.editalId || currentEditalId;
                let novoEstudoRev = null;
                let novoTempoRev = null;

                if (questoes > 0) {
                    novoEstudoRev = { 
                        id: Date.now().toString() + '_revQ', 
                        editalId: editalIdRef,
                        data: getTodayDate(), 
                        disciplina: originalStudy.disciplina, 
                        assunto: originalStudy.assunto, 
                        total: questoes, 
                        acertos: acertos, 
                        percentual: questoes > 0 ? (acertos/questoes)*100 : 0,
                        tempo: tempo, 
                        revisoes: [] 
                    };
                    db.estudos.push(novoEstudoRev);
                }
                
                if (tempo > 0) {
                    novoTempoRev = { 
                        id: Date.now().toString() + '_revT', 
                        editalId: editalIdRef,
                        data: getTodayDate(), 
                        disciplina: originalStudy.disciplina, 
                        assunto: originalStudy.assunto, 
                        tempoMinutos: tempo, 
                        tipo: 'revisao' 
                    };
                    db.tempoEstudos.push(novoTempoRev);
                }
                
                if (novoEstudoRev || novoTempoRev) {
                    await saveIncremental({ estudo: novoEstudoRev, tempo: novoTempoRev });
                }

                await updateRevisionStatus(id, idx);

                renderHomePage(); 
                renderDisciplinas(); 
                if(document.getElementById('page-estatisticas').classList.contains('active')) renderEstatisticas();

                modalBackdrop.classList.remove('active'); 
                document.getElementById('revisao-modal').classList.remove('active'); 
                alert("Revisão concluída!");
            }
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar revisão: " + e.message);
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
            isSaving = false;
        }
    });

    const renderEstatisticas = () => {
        const edital = getCurrentEdital();
        if (!edital) return; 

        const dFiltro = document.getElementById('filter-disciplina').value; 
        const ini = document.getElementById('filter-data-inicio').value; 
        const fim = document.getElementById('filter-data-fim').value;
        
        const baseEstudos = filterStudiesByEdital(db.estudos);
        const baseTempos = filterStudiesByEdital(db.tempoEstudos);

        const estudosF = baseEstudos.filter(e => { 
            const eData = e.data.includes('T') ? e.data.split('T')[0] : e.data; 
            return (dFiltro === 'todas' || e.disciplina === dFiltro) && 
                   (!ini || eData >= ini) && 
                   (!fim || eData <= fim); 
        });
        
        const tempoF = baseTempos.filter(t => { 
            const tData = t.data.includes('T') ? t.data.split('T')[0] : t.data;
            return (dFiltro === 'todas' || t.disciplina === dFiltro) && 
                   (!ini || tData >= ini) && 
                   (!fim || tData <= fim); 
        });
        
        const totMin = tempoF.reduce((a,b) => a + b.tempoMinutos, 0); 
        document.getElementById('stat-total-horas').textContent = formatDuration(totMin);
        
        let totQ = 0, totA = 0; 
        estudosF.forEach(e => { 
            if (e.disciplina !== 'Flashcards') { // Ignora flashcards na estatística global de questões
                totQ += (Number(e.total) || 0); 
                totA += (Number(e.acertos) || 0); 
            }
        }); 
        document.getElementById('stat-total-questoes').textContent = totQ; 
        document.getElementById('stat-media-geral').textContent = totQ > 0 ? `${Math.round((totA/totQ)*100)}%` : '0%';
        
        renderCharts(edital, estudosF, tempoF); 
        renderHistorico(estudosF, ini, fim);
    };

    const generatePDF = () => {
        const { jsPDF } = window.jspdf;
        if (!jsPDF) return alert("Erro: Biblioteca PDF não carregada.");

        const edital = getCurrentEdital();
        if (!edital) return alert("Selecione um edital.");

        const dFiltro = document.getElementById('filter-disciplina').value; 
        const ini = document.getElementById('filter-data-inicio').value; 
        const fim = document.getElementById('filter-data-fim').value;

        const baseEstudos = filterStudiesByEdital(db.estudos);
        const estudosF = baseEstudos.filter(e => { 
            const eData = e.data.includes('T') ? e.data.split('T')[0] : e.data;
            return (dFiltro === 'todas' || e.disciplina === dFiltro) && 
                   (!ini || eData >= ini) && 
                   (!fim || eData <= fim); 
        }).sort((a, b) => new Date(b.data) - new Date(a.data));

        if(estudosF.length === 0) return alert("Nenhum registro encontrado com os filtros atuais.");

        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text(`Relatório de Estudos - ${edital.nome}`, 14, 20);
        
        doc.setFontSize(10);
        const filtroTexto = `Gerado em: ${new Date().toLocaleDateString()} | Filtro: ${dFiltro === 'todas' ? 'Todas Disciplinas' : dFiltro}`;
        doc.text(filtroTexto, 14, 28);

        const tableBody = estudosF.map(e => [
            formatDateBr(e.data),
            e.disciplina,
            e.assunto,
            e.intervalo || "-",
            e.tempo ? formatDuration(e.tempo) : "-", 
            e.total > 0 ? `${e.acertos}/${e.total} (${Math.round(e.percentual)}%)` : "-",
        ]);

        doc.autoTable({
            startY: 35,
            head: [['Data', 'Disciplina', 'Assunto', 'Intervalo', 'Tempo', 'Desempenho']],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [79, 70, 229] }
        });

        doc.save(`relatorio_estudos_${getTodayDate()}.pdf`);
    };

    const setupStatsListeners = () => {
        const inputs = ['filter-disciplina', 'filter-data-inicio', 'filter-data-fim'];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('change', renderEstatisticas);
        });

        const btnPDF = document.getElementById('btn-generate-pdf');
        if(btnPDF) btnPDF.addEventListener('click', generatePDF);
    };

    const renderCharts = (edital, estudos, tempos) => {
        const labels = edital.disciplinas.map(d => d.nome); 
        const textColor = document.body.dataset.theme === 'dark' ? '#f0f0f0' : '#333'; 
        
        if(typeof Chart !== 'undefined') Chart.defaults.color = textColor;
        
        const dataAcertos = labels.map(label => { const es = estudos.filter(e => e.disciplina === label); let q=0, a=0; es.forEach(x => { q+=x.total; a+=x.acertos; }); return q>0 ? (a/q)*100 : 0; });
        const dataTempo = labels.map(label => { const ts = tempos.filter(t => t.disciplina === label); return (ts.reduce((acc,c)=>acc+c.tempoMinutos,0) / 60).toFixed(1); });
        
        const dataCob = labels.map(label => { 
            const d = edital.disciplinas.find(x => x.nome === label); if(!d) return 0; 
            const uniqueStudied = new Set([
                ...estudos.filter(e=>e.disciplina===label).map(e=>e.assunto), 
                ...tempos.filter(t=>t.disciplina===label).map(t=>t.assunto), 
                ...db.assuntosManuais.filter(m=>m.disciplina===label && (!m.editalId || m.editalId === edital.id)).map(m=>m.assunto)
            ]); 
            return d.assuntos.length > 0 ? (uniqueStudied.size / d.assuntos.length)*100 : 0; 
        });

        const minHeight = 300;
        const dynamicHeight = Math.max(minHeight, labels.length * 35);
        const heightStr = `${dynamicHeight}px`;

        ['chart-acertos', 'chart-tempo', 'chart-cobertura'].forEach(id => {
            const el = document.getElementById(id);
            if(el && el.parentElement) {
                el.parentElement.style.height = heightStr;
            }
        });

        const commonOpts = {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', 
            scales: {
                x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                y: { grid: { display: false }, ticks: { autoSkip: false } }
            },
            plugins: {
                legend: { display: false }
            }
        };
        
        if(charts.acertos) charts.acertos.destroy(); 
        if(document.getElementById('chart-acertos')) charts.acertos = new Chart(document.getElementById('chart-acertos'), { 
            type: 'bar', 
            data: { labels, datasets: [{ label: '% Acerto', data: dataAcertos, backgroundColor: '#4f46e5' }] }, 
            options: { 
                ...commonOpts, 
                scales: { ...commonOpts.scales, x: { ...commonOpts.scales.x, max: 100 } } 
            } 
        });
        
        if(charts.tempo) charts.tempo.destroy(); 
        if(document.getElementById('chart-tempo')) charts.tempo = new Chart(document.getElementById('chart-tempo'), { 
            type: 'bar', 
            data: { labels, datasets: [{ label: 'Horas', data: dataTempo, backgroundColor: '#8b5cf6' }] }, 
            options: commonOpts 
        });
        
        if(charts.cobertura) charts.cobertura.destroy(); 
        if(document.getElementById('chart-cobertura')) charts.cobertura = new Chart(document.getElementById('chart-cobertura'), { 
            type: 'bar', 
            data: { labels, datasets: [{ label: '% Concluído', data: dataCob, backgroundColor: '#22c55e' }] }, 
            options: { 
                ...commonOpts, 
                scales: { ...commonOpts.scales, x: { ...commonOpts.scales.x, max: 100 } } 
            } 
        });
    };

    const renderHistorico = (estudos, dataInicio, dataFim) => {
        const container = document.getElementById('stat-historico-revisoes'); 
        
        let filteredEstudos = estudos.filter(e => {
            if (e.data === 'SEM_DATA') return true; 
            const d = e.data.includes('T') ? e.data.split('T')[0] : e.data;
            if (dataInicio && d < dataInicio) return false;
            if (dataFim && d > dataFim) return false;
            return true;
        });

        if(filteredEstudos.length === 0) { container.innerHTML = '<p class="empty-state">Sem dados neste período.</p>'; return; }
        
        const sortedEstudos = filteredEstudos.slice().sort((a, b) => {
            if (a.data === 'SEM_DATA') return 1;
            if (b.data === 'SEM_DATA') return -1;
            return new Date(b.data) - new Date(a.data);
        });

        const displayLimit = (dataInicio || dataFim) ? sortedEstudos.length : 50;

        container.innerHTML = sortedEstudos.slice(0, displayLimit).map(e => { 
            const dataF = formatDateBr(e.data); 
            let revBadge = '';
            
            if (e.revisoes && e.revisoes.length > 0) {
                const total = e.revisoes.length;
                const concluidas = e.revisoes.filter(r => r.concluida).length;
                const statusColor = concluidas === total ? 'var(--success-color)' : 'var(--warning-color)';
                
                const revDetails = e.revisoes.map((r, i) => {
                    const label = i === 0 ? '1d' : i === 1 ? '7d' : '30d';
                    const icon = r.concluida ? '✓' : '○';
                    const style = r.concluida ? 'color:var(--success-color); font-weight:bold;' : 'color:var(--text-light);';
                    return `<span style="${style} margin-right:5px; font-size:0.75rem;">[${icon}] ${label}</span>`;
                }).join('');

                revBadge = `<div style="margin-top:5px; font-size:0.8rem;">
                    <strong style="color:${statusColor}; font-size:0.75rem; text-transform:uppercase; margin-right:5px;">Revisões:</strong>
                    ${revDetails}
                </div>`;
            }

            const desempenho = e.total > 0 
                ? `${e.acertos}/${e.total} acertos (<strong style="color:${e.percentual>=80?'var(--success-color)':e.percentual<50?'var(--danger-color)':'var(--warning-color)'}">${Math.round(e.percentual)}%</strong>)` 
                : `<span style="color:var(--secondary-color); font-style:italic;">Estudo Teórico / Leitura</span>`;

            const htmlIntervalo = e.intervalo 
                ? `<div style="font-size:0.8rem; color:var(--secondary-color);"><i class="ph ph-bookmark-simple"></i> ${e.intervalo}</div>` 
                : '';

            return `
            <div style="padding:12px; border-bottom:1px solid var(--border-color); display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; justify-content:space-between;">
                    <span style="font-weight:600; color:var(--text-color);">${e.disciplina}</span>
                    <span style="font-size:0.8rem; color:var(--text-light);">${dataF}</span>
                </div>
                <div style="color:var(--text-color); font-size:0.9rem;">${e.assunto}</div>
                ${htmlIntervalo}
                <div style="font-size:0.85rem; color:var(--text-light);">${desempenho}</div>
                ${revBadge}
            </div>`; 
        }).join('');
        
        if (sortedEstudos.length > displayLimit) {
            container.innerHTML += `<div style="text-align:center; padding:15px; color:var(--text-light); font-size:0.9rem; font-style:italic;">
                Exibindo os ${displayLimit} últimos registros. Use os filtros de data para ver mais antigos.
            </div>`;
        }
    };

    const initTimerDOM = () => {
        const display = document.getElementById('timer-display'); 
        const btnToggle = document.getElementById('timer-toggle-btn'); 
        const btnReset = document.getElementById('timer-reset-btn');
        const btnTransfer = document.getElementById('timer-transfer-btn'); 
        const containerSave = document.getElementById('timer-save-container'); 
        const phases = document.querySelectorAll('.phase-badge');
        const btnOpenTimer = document.getElementById('btn-open-timer-main'); 
        const miniDisplay = document.getElementById('mini-timer-display');
        
        if(btnOpenTimer) btnOpenTimer.addEventListener('click', () => { modalBackdrop.classList.add('active'); document.getElementById('timer-modal').classList.add('active'); });
        
        const updateDisplay = () => { 
            const m = Math.floor(timer.seconds / 60); const s = timer.seconds % 60; const timeStr = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
            if(display) display.textContent = timeStr; 
            if (timer.running) { if(miniDisplay) {miniDisplay.textContent = timeStr; miniDisplay.style.color = '#fff';} document.title = `${timeStr} - Foco`; } else { if(miniDisplay) {miniDisplay.textContent = "Iniciar"; miniDisplay.style.color = '#fff';} document.title = 'StudyApp'; }
            phases.forEach(p => p.classList.remove('active')); if(timer.mode === 'pomodoro') { document.querySelector(`.phase-badge[data-phase="${timer.phase}"]`)?.classList.add('active'); }
        };
        const playAlarm = () => { if(audioAlarm) { audioAlarm.currentTime = 0; audioAlarm.play().catch(e => console.log("Permissão necessária")); } };
        const tick = () => { 
            if(timer.mode === 'pomodoro') {
                if(timer.seconds > 0) { timer.seconds--; if(timer.phase === 'focus') timer.accumulated++; } else { 
                    timer.running = false; clearInterval(timer.interval); btnToggle.innerHTML = '<i class="ph ph-play"></i> Iniciar'; playAlarm(); alert("Tempo esgotado!"); if(timer.accumulated > 0) containerSave.style.display = 'block';
                    if(timer.phase === 'focus') { timer.phase = 'short'; timer.seconds = timer.settings.short * 60; } else { timer.phase = 'focus'; timer.seconds = timer.settings.focus * 60; }
                }
            } else { timer.seconds++; timer.accumulated++; }
            updateDisplay(); 
        };
        if(btnToggle) btnToggle.addEventListener('click', () => { 
            if(timer.running) { clearInterval(timer.interval); timer.running = false; btnToggle.innerHTML = '<i class="ph ph-play"></i> Retomar'; if(timer.accumulated > 60) containerSave.style.display = 'block'; } else { timer.interval = setInterval(tick, 1000); timer.running = true; btnToggle.innerHTML = '<i class="ph ph-pause"></i> Pausar'; containerSave.style.display = 'none'; } 
            updateDisplay();
        });
        if(btnReset) btnReset.addEventListener('click', () => { 
            clearInterval(timer.interval); timer.running = false; 
            if(timer.mode === 'pomodoro') { timer.seconds = timer.settings.focus * 60; timer.phase = 'focus'; } else { timer.seconds = 0; }
            timer.accumulated = 0; btnToggle.innerHTML = '<i class="ph ph-play"></i> Iniciar'; containerSave.style.display = 'none'; updateDisplay(); 
        });
        document.querySelectorAll('.mode-btn').forEach(btn => { 
            btn.addEventListener('click', () => { 
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); timer.mode = btn.dataset.mode; 
                const phasesContainer = document.getElementById('pomodoro-phases'); if(timer.mode === 'livre') phasesContainer.style.visibility = 'hidden'; else phasesContainer.style.visibility = 'visible';
                if(btnReset) btnReset.click(); 
            }); 
        });
        if(btnTransfer) btnTransfer.addEventListener('click', () => { 
            const mins = Math.ceil(timer.accumulated / 60); 
            if(mins < 1) return alert("Tempo curto."); 
            modalBackdrop.classList.remove('active'); 
            document.getElementById('timer-modal').classList.remove('active'); 
            openRegistroModal(null); 
            document.getElementById('reg-tempo').value = mins; 
            containerSave.style.display = 'none'; 
            timer.accumulated = 0; 
            if(timer.mode === 'livre' && btnReset) btnReset.click(); 
        });
    };

    const openProfileModal = () => {
        document.getElementById('profile-name').value = currentUser.name || '';
        document.getElementById('profile-email').value = currentUser.email || '';
        document.getElementById('profile-password').value = '';
        modalBackdrop.classList.add('active');
        document.getElementById('profile-modal').classList.add('active');
    };

    const btnProfile = document.getElementById('btn-profile');
    if(btnProfile) btnProfile.addEventListener('click', openProfileModal);

    const btnSaveProfile = document.getElementById('btn-save-profile');
    if(btnSaveProfile) {
        btnSaveProfile.addEventListener('click', async () => {
            const name = document.getElementById('profile-name').value;
            const password = document.getElementById('profile-password').value;
            try {
                const res = await fetch(`${API_URL}/auth/profile`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
                    body: JSON.stringify({ name, password: password || undefined })
                });
                const data = await res.json();
                if(res.ok) {
                    currentUser = data.user;
                    localStorage.setItem('user', JSON.stringify(currentUser));
                    alert("Perfil atualizado!");
                    modalBackdrop.classList.remove('active');
                    document.getElementById('profile-modal').classList.remove('active');
                } else { alert("Erro: " + data.msg); }
            } catch(e) { alert("Erro de conexão"); }
        });
    }

    const btnDelAccount = document.getElementById('btn-delete-account');
    if(btnDelAccount) {
        btnDelAccount.addEventListener('click', async () => {
            if(confirm("Tem certeza? Isso apagará TUDO permanentemente.")) {
                if(confirm("Confirmação final: Essa ação não pode ser desfeita.")) {
                    try {
                        const res = await fetch(`${API_URL}/auth/account`, {
                            method: 'DELETE', headers: { 'x-auth-token': authToken }
                        });
                        if(res.ok) { alert("Conta excluída."); localStorage.clear(); location.reload(); }
                    } catch(e) { alert("Erro ao excluir"); }
                }
            }
        });
    }

    async function loadAdminData() {
        try {
            const res = await fetch(`${API_URL}/admin/users`, { headers: { 'x-auth-token': authToken } });
            if (!res.ok) return alert("Acesso negado.");
            const data = await res.json();
            
            renderAdminUsers(data.users);

            const modalBody = document.querySelector('#admin-modal .modal-body');
            
            if (!document.getElementById('btn-cleanup-db')) {
                const cleanDiv = document.createElement('div');
                cleanDiv.className = 'card';
                cleanDiv.style.cssText = 'margin-bottom: 20px; padding: 15px; border: 1px solid var(--warning-color); background: rgba(245, 158, 11, 0.05);';
                cleanDiv.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>Limpeza de Banco de Dados</strong><br>
                            <small style="color:var(--text-light)">Remove duplicatas e otimiza o armazenamento.</small>
                        </div>
                        <button id="btn-cleanup-db" class="btn-sm" style="background:var(--warning-color); color:#fff; border:none; padding:8px 12px; border-radius:4px; cursor:pointer;">
                            <i class="ph ph-broom"></i> Faxinar Agora
                        </button>
                    </div>
                `;
                modalBody.insertBefore(cleanDiv, modalBody.firstChild);
                
                document.getElementById('btn-cleanup-db').addEventListener('click', runCleanup);
            }
            
            modalBackdrop.classList.add('active');
            document.getElementById('admin-modal').classList.add('active');
        } catch(e) { 
            console.error(e);
            alert("Erro ao carregar painel admin."); 
        }
    }

    const btnAdminCreateUser = document.getElementById('btn-admin-create-user');
    if(btnAdminCreateUser) {
        btnAdminCreateUser.addEventListener('click', async () => {
            const name = document.getElementById('admin-new-name').value;
            const email = document.getElementById('admin-new-email').value;
            const password = document.getElementById('admin-new-pwd').value;

            if(!name || !email || !password) return alert("Preencha nome, email e senha.");

            try {
                const btn = btnAdminCreateUser;
                btn.textContent = "Criando...";
                btn.disabled = true;

                const res = await fetch(`${API_URL}/admin/create-user`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
                    body: JSON.stringify({ name, email, password })
                });
                const data = await res.json();
                
                if(res.ok) {
                    alert(data.msg);
                    document.getElementById('admin-new-name').value = '';
                    document.getElementById('admin-new-email').value = '';
                    document.getElementById('admin-new-pwd').value = '';
                    loadAdminData(); 
                } else {
                    alert("Erro: " + data.msg);
                }
                
                btn.innerHTML = '<i class="ph ph-user-plus"></i> Cadastrar Usuário';
                btn.disabled = false;
            } catch(e) {
                alert("Erro de conexão ao criar usuário.");
                btnAdminCreateUser.innerHTML = '<i class="ph ph-user-plus"></i> Cadastrar Usuário';
                btnAdminCreateUser.disabled = false;
            }
        });
    }

    async function runCleanup() {
        if(!confirm("Tem certeza? Isso irá apagar registros duplicados de TODOS os usuários. Essa ação não pode ser desfeita.")) return;
        
        const btn = document.getElementById('btn-cleanup-db');
        const originalText = btn.innerHTML;
        btn.innerHTML = "Limpando...";
        btn.disabled = true;

        try {
            const res = await fetch(`${API_URL}/admin/cleanup`, {
                method: 'POST',
                headers: { 'x-auth-token': authToken }
            });
            const data = await res.json();
            
            if(res.ok) {
                alert("Sucesso!\n" + data.details);
                loadDataFromCloud();
            } else {
                alert("Erro: " + data.msg);
            }
        } catch(e) {
            alert("Erro de conexão.");
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    const btnAdminPanel = document.getElementById('btn-admin-panel');
    if(btnAdminPanel) btnAdminPanel.addEventListener('click', loadAdminData);

    function renderAdminUsers(users) {
        const tbody = document.getElementById('admin-users-list');
        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.name} ${u.role==='admin'?'<span style="color:var(--primary-color)">(Admin)</span>':''}</td>
                <td>${u.email}</td>
                <td>
                    ${u.role!=='admin' ? `<button class="btn-danger btn-sm" onclick="deleteUserAdmin('${u._id}')"><i class="ph ph-trash"></i></button>` : '-'}
                </td>
            </tr>
        `).join('');
    }

    window.deleteUserAdmin = async (id) => {
        if(confirm("Administrador: Deseja realmente excluir este usuário?")) {
            try {
                const res = await fetch(`${API_URL}/admin/user/${id}`, { method: 'DELETE', headers: { 'x-auth-token': authToken } });
                if(res.ok) loadAdminData();
                else alert("Erro ao excluir.");
            } catch(e) { alert("Erro servidor."); }
        }
    };
    
    const toggleTheme = () => {
        const t = document.body.dataset.theme==='dark'?'light':'dark';
        document.body.dataset.theme=t;
        localStorage.setItem('studyAppTheme', t);
    };
    
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    document.querySelectorAll('.modal-close-btn').forEach(b => b.addEventListener('click', () => { 
        if (b.id === 'btn-close-edit-modal') return; 
        modalBackdrop.classList.remove('active'); 
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active')); 
    }));
    
    const savedTheme = localStorage.getItem('studyAppTheme');
    if(savedTheme) document.body.dataset.theme = savedTheme;
    
    const updateSelects = () => { 
        const select = document.getElementById('filter-disciplina'); 
        const edital = getCurrentEdital();
        if(select && edital) {
            const opts = edital.disciplinas.map(d => `<option value="${d.nome}">${d.nome}</option>`).join(''); 
            select.innerHTML = '<option value="todas">Todas</option>' + opts;
        } 
    };

    const elConfigMeta = document.getElementById('config-meta-horas');
    if(elConfigMeta) elConfigMeta.addEventListener('change', (e) => { 
        const val = parseInt(e.target.value); 
        const edital = getCurrentEdital();
        if(val > 0 && edital && edital.ciclo) { edital.ciclo.metaHoras = val; saveData(); } 
    });

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.id === 'page-estatisticas' && mutation.target.classList.contains('active')) {
                updateSelects();
                renderEstatisticas();
            }
        });
    });
    pages.forEach(p => observer.observe(p, { attributes: true, attributeFilter: ['class'] }));

    setupStatsListeners();
    checkAuth();
    initTimerDOM();
});