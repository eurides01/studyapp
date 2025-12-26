document.addEventListener('DOMContentLoaded', () => {

    // ===== 1. CONFIGURAÇÃO DA API =====
    // Detecta se está no computador (localhost) ou na nuvem (Render)
    const API_URL = window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1')
        ? 'http://localhost:5000/api'
        : '/api';
        
    let authToken = localStorage.getItem('token');
    let currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    // ===== 2. ESTADO GLOBAL (DATABASE LOCAL) =====
    let db = {
        disciplinas: [],
        estudos: [],       
        tempoEstudos: [],  
        assuntosManuais: [], 
        ciclo: { deck: [], disciplinasPorDia: 3, metaHoras: 4 }
    };

    let charts = { acertos: null, tempo: null, cobertura: null };
    const audioAlarm = document.getElementById('timer-sound');
    
    // Estado do Timer
    let timer = {
        interval: null,
        running: false,
        mode: 'pomodoro', 
        phase: 'focus',
        seconds: 1500,
        accumulated: 0,
        settings: { focus: 25, short: 5, long: 15 }
    };

    // ===== 3. SELETORES GERAIS =====
    const authScreen = document.getElementById('auth-screen');
    const navBar = document.querySelector('.navbar');
    const mainContainer = document.querySelector('.container'); // Ajuste se seu HTML usar <main> direto
    const modalBackdrop = document.getElementById('modal-backdrop');
    const pages = document.querySelectorAll('.page');
    const navLinks = document.querySelectorAll('.nav-link');
    const menuToggle = document.getElementById('menu-toggle');
    const navLinksContainer = document.querySelector('.nav-links');

    // ===== 4. CONTROLE DE AUTENTICAÇÃO E UI =====

    const checkAuth = () => {
        if(authToken) {
            authScreen.style.display = 'none';
            navBar.style.display = 'flex';
            // Garante que o container principal apareça
            if(mainContainer) mainContainer.style.display = 'block';
            
            // Controle do botão Admin
            const btnAdmin = document.getElementById('btn-admin-panel');
            if (btnAdmin) {
                if (currentUser && currentUser.role === 'admin') {
                    btnAdmin.style.display = 'flex';
                } else {
                    btnAdmin.style.display = 'none';
                }
            }
            
            loadDataFromCloud();
        } else {
            authScreen.style.display = 'flex';
            navBar.style.display = 'none';
            if(mainContainer) mainContainer.style.display = 'none';
        }
    };

    const handleAuth = async (endpoint) => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const name = "Estudante"; // Futuramente pode vir de um input

        if(!email || !password) return alert("Preencha email e senha!");
        
        try {
            const res = await fetch(`${API_URL}/auth/${endpoint}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name, email, password })
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
        } catch(err) {
            console.error(err);
            alert("Erro de conexão. Verifique se o servidor está rodando.");
        }
    };

    // Listeners de Login/Registro
    const btnLogin = document.getElementById('btn-login');
    const btnRegister = document.getElementById('btn-register');
    if (btnLogin) btnLogin.addEventListener('click', () => handleAuth('login'));
    if (btnRegister) btnRegister.addEventListener('click', () => handleAuth('register'));
    
    document.getElementById('btn-logout').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        location.reload();
    });

    // ===== 5. SINCRONIZAÇÃO DE DADOS (CLOUD) =====

    const loadDataFromCloud = async () => {
        if(!authToken) return;
        try {
            const res = await fetch(`${API_URL}/data`, {
                headers: { 'x-auth-token': authToken }
            });
            
            if(res.ok) {
                const cloudData = await res.json();
                db = { ...db, ...cloudData };
                
                // Validações de estrutura para evitar erros
                if (!db.tempoEstudos) db.tempoEstudos = [];
                if (!db.assuntosManuais) db.assuntosManuais = [];
                if (!db.ciclo) db.ciclo = { deck: [], disciplinasPorDia: 3, metaHoras: 4 };
                if (!Array.isArray(db.ciclo.deck)) db.ciclo.deck = [];

                // Renderiza a Home e atualiza configurações
                renderHomePage();
                updateSelects(); 
                
                // Aplica tema salvo
                const theme = localStorage.getItem('studyAppTheme') || 'light';
                document.body.dataset.theme = theme;
            } else if(res.status === 401) {
                // Token expirou
                localStorage.clear();
                location.reload();
            }
        } catch (err) {
            console.error("Erro ao carregar dados", err);
        }
    };

    const saveData = async () => {
        // Atualização Otimista (Visual)
        updateSummaries(); 
        calculateStreakStats(); 
        renderHeatmap(); 
        renderDashboardTable();

        if(!authToken) return;
        try {
            await fetch(`${API_URL}/data`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-auth-token': authToken
                },
                body: JSON.stringify(db)
            });
        } catch (err) {
            console.error("Erro ao salvar na nuvem", err);
        }
    };

    // ===== 6. FUNCIONALIDADES DE PERFIL E ADMIN =====

    // Abrir Modal Perfil
    const btnProfile = document.getElementById('btn-profile');
    if(btnProfile) {
        btnProfile.addEventListener('click', () => {
            document.getElementById('profile-name').value = currentUser.name || '';
            document.getElementById('profile-email').value = currentUser.email || '';
            document.getElementById('profile-password').value = '';
            modalBackdrop.classList.add('active');
            document.getElementById('profile-modal').classList.add('active');
        });
    }

    // Salvar Perfil
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
                } else {
                    alert("Erro: " + data.msg);
                }
            } catch(e) { alert("Erro de conexão"); }
        });
    }

    // Deletar Conta
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

    // Painel Admin
    const btnAdminPanel = document.getElementById('btn-admin-panel');
    if(btnAdminPanel) btnAdminPanel.addEventListener('click', loadAdminData);

    async function loadAdminData() {
        try {
            const res = await fetch(`${API_URL}/admin/users`, { headers: { 'x-auth-token': authToken } });
            if (!res.ok) return alert("Acesso negado.");
            const data = await res.json();
            
            renderAdminUsers(data.users);
            updateRegButton(data.registrationOpen);
            
            modalBackdrop.classList.add('active');
            document.getElementById('admin-modal').classList.add('active');
        } catch(e) { alert("Erro ao carregar painel admin."); }
    }

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

    function updateRegButton(isOpen) {
        const btn = document.getElementById('btn-toggle-reg');
        if(isOpen) {
            btn.textContent = "Bloquear Novos Registros";
            btn.className = "btn-sm btn-danger";
        } else {
            btn.textContent = "Liberar Novos Registros";
            btn.className = "btn-sm btn-success";
        }
        btn.onclick = toggleRegistration;
    }

    async function toggleRegistration() {
        try {
            const res = await fetch(`${API_URL}/admin/toggle-registration`, { method: 'POST', headers: { 'x-auth-token': authToken } });
            const data = await res.json();
            updateRegButton(data.status);
            alert(data.msg);
        } catch(e) { alert("Erro."); }
    }


    // ===== 7. FUNÇÕES AUXILIARES DE DATA E FORMATAÇÃO =====

    const getTodayDate = () => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const formatDateBr = (dateStr) => {
        if(!dateStr) return "-";
        if(dateStr.includes('T')) dateStr = dateStr.split('T')[0];
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    };

    const formatDuration = (m) => `${Math.floor(m/60)}h ${m%60}m`;
    
    const addDays = (dateStr, days) => {
        if(dateStr.includes('T')) dateStr = dateStr.split('T')[0];
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d + days, 12, 0, 0);
        const resY = dateObj.getFullYear();
        const resM = String(dateObj.getMonth() + 1).padStart(2, '0');
        const resD = String(dateObj.getDate()).padStart(2, '0');
        return `${resY}-${resM}-${resD}`;
    };

    const diffInDays = (date1Str, date2Str) => {
        if(!date1Str || !date2Str) return 0;
        if(date1Str.includes('T')) date1Str = date1Str.split('T')[0];
        if(date2Str.includes('T')) date2Str = date2Str.split('T')[0];
        const d1 = new Date(date1Str + 'T12:00:00');
        const d2 = new Date(date2Str + 'T12:00:00');
        return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    };

    // ===== 8. NAVEGAÇÃO ENTRE ABAS =====

    const showPage = (pageId) => {
        // Esconde todas as páginas
        pages.forEach(p => p.classList.remove('active'));
        
        // Atualiza os links da navbar
        navLinks.forEach(l => {
            l.classList.remove('active');
            if (l.dataset.page === pageId) l.classList.add('active');
        });

        // Mostra a página selecionada
        const targetPage = document.getElementById(pageId);
        if(targetPage) targetPage.classList.add('active');
        
        // Fecha menu mobile se estiver aberto
        if(navLinksContainer) navLinksContainer.classList.remove('show');

        // Renderiza conteúdo específico da página
        if (pageId === 'page-home') renderHomePage();
        if (pageId === 'page-disciplinas') renderDisciplinas();
        if (pageId === 'page-estatisticas') renderEstatisticas();
        if (pageId === 'page-ciclo') renderCicloConfig();
    };

    // Listeners de navegação
    navLinks.forEach(l => l.addEventListener('click', (e) => { 
        e.preventDefault(); 
        showPage(l.dataset.page); 
    }));
    
    if(menuToggle) menuToggle.addEventListener('click', () => navLinksContainer.classList.toggle('show'));


    // ===== 9. RENDERIZAÇÃO DA HOME (DASHBOARD) =====

    const renderHomePage = () => {
        updateSummaries();
        renderCicloFila(); 
        renderRevisoesPendentes();
        renderHeatmap();
        calculateStreakStats(); 
        renderDashboardTable();
    };

    const updateSummaries = () => {
        const today = getTodayDate();
        const metaHoras = db.ciclo.metaHoras || 4;
        
        const minsHoje = db.tempoEstudos.filter(t => {
            const tData = t.data.includes('T') ? t.data.split('T')[0] : t.data;
            return tData === today;
        }).reduce((acc, c) => acc + c.tempoMinutos, 0);

        const h = Math.floor(minsHoje / 60); const m = minsHoje % 60;
        
        const elMeta = document.getElementById('dash-meta-horas');
        if(elMeta) elMeta.textContent = `${h}h ${m}m / ${metaHoras}h`;
        
        const elTempo = document.getElementById('dash-tempo');
        if(elTempo) elTempo.textContent = formatDuration(minsHoje);

        let q = 0, a = 0;
        db.estudos.filter(e => {
            const eData = e.data.includes('T') ? e.data.split('T')[0] : e.data;
            return eData === today;
        }).forEach(e => { q += e.total; a += e.acertos; });
        
        const elAcertos = document.getElementById('dash-acertos');
        if(elAcertos) elAcertos.textContent = q > 0 ? `${Math.round((a/q)*100)}%` : '-';

        let pends = 0;
        db.estudos.forEach(e => {
            if(e.revisoes) e.revisoes.forEach(r => { 
                const rData = r.data.includes('T') ? r.data.split('T')[0] : r.data;
                if(!r.concluida && rData <= today) pends++; 
            });
        });
        const elRev = document.getElementById('dash-revisoes');
        if(elRev) elRev.textContent = pends;
    };

    const calculateStreakStats = () => {
        const rawDates = new Set([
            ...db.estudos.map(e => e.data),
            ...db.tempoEstudos.map(t => t.data)
        ]);
        const sanitizedDates = new Set();
        rawDates.forEach(d => {
            if(d) sanitizedDates.add(d.includes('T') ? d.split('T')[0] : d);
        });
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
                    if (diffInDays(prevDate, checkDateStr) === 1) { 
                        currentStreak++; checkDateStr = prevDate; 
                    } else break;
                }
            }
        }
        
        const elStreakNav = document.getElementById('nav-streak-count');
        if(elStreakNav) elStreakNav.textContent = currentStreak;
        
        const currEl = document.getElementById('current-streak-val');
        const recEl = document.getElementById('record-streak-val');
        if(currEl) currEl.textContent = currentStreak;
        if(recEl) recEl.textContent = maxStreak;
    };

    const renderHeatmap = () => {
        const container = document.getElementById('heatmap-container');
        if (!container) return;
        container.innerHTML = '';
        
        const dataMap = {};
        db.tempoEstudos.forEach(t => { 
            const d = t.data.includes('T') ? t.data.split('T')[0] : t.data;
            dataMap[d] = (dataMap[d] || 0) + t.tempoMinutos; 
        });
        const todayStr = getTodayDate();
        for (let i = 29; i >= 0; i--) {
            const dateStr = addDays(todayStr, -i);
            const minutes = dataMap[dateStr] || 0;
            const statusClass = minutes > 0 ? 'studied' : 'missed';
            const square = document.createElement('div');
            square.className = `heatmap-square ${statusClass}`;
            square.title = `${formatDateBr(dateStr)}: ${minutes} min`;
            container.appendChild(square);
        }
    };

    const renderDashboardTable = () => {
        const tbody = document.getElementById('dashboard-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (db.disciplinas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-light)">Nenhum dado disponível.</td></tr>';
            return;
        }
        db.disciplinas.forEach(d => {
            const studies = db.estudos.filter(e => e.disciplina === d.nome);
            const times = db.tempoEstudos.filter(t => t.disciplina === d.nome);
            const totalQ = studies.reduce((acc, e) => acc + e.total, 0);
            const totalA = studies.reduce((acc, e) => acc + e.acertos, 0);
            const totalE = totalQ - totalA;
            const perc = totalQ > 0 ? Math.round((totalA / totalQ) * 100) : 0;
            const totalMins = times.reduce((acc, t) => acc + t.tempoMinutos, 0);
            let color = 'var(--text-color)';
            if (totalQ > 0) {
                if (perc >= 80) color = 'var(--success-color)';
                else if (perc < 50) color = 'var(--danger-color)';
                else color = 'var(--warning-color)';
            }
            tbody.innerHTML += `<tr><td>${d.nome}</td><td>${totalQ}</td><td style="color:var(--success-color)">${totalA}</td><td style="color:var(--danger-color)">${totalE}</td><td style="font-weight:600; color:${color}">${perc}%</td><td>${formatDuration(totalMins)}</td></tr>`;
        });
    };

    const renderCicloFila = () => {
        const container = document.getElementById('ciclo-hoje-list');
        const deck = db.ciclo.deck;
        const limit = db.ciclo.disciplinasPorDia || 3;
        
        if (!deck || deck.length === 0) { 
            container.innerHTML = '<p class="empty-state">Ciclo vazio. Configure na aba Ciclo.</p>'; return; 
        }
        const visibleItems = deck.slice(0, limit);
        container.innerHTML = visibleItems.map((disc, index) => {
            const today = getTodayDate();
            const studiedToday = db.tempoEstudos.some(t => {
                const tData = t.data.includes('T') ? t.data.split('T')[0] : t.data;
                return tData === today && t.disciplina === disc && t.tipo !== 'revisao';
            });
            const statusIcon = studiedToday ? '<i class="ph ph-check-circle" style="color:var(--success-color)"></i>' : '<i class="ph ph-books"></i>';
            return `<div class="ciclo-item-card"><div class="ciclo-info"><h4>${statusIcon} ${disc}</h4><small>Posição: ${index + 1}</small></div><div class="ciclo-actions"><button class="action-btn btn-manual-action" onclick="openRegistroModal('${disc}')"><span><i class="ph ph-pencil-simple"></i></span> Registrar</button></div></div>`;
        }).join('');
    };

    const rotateCycle = (disc) => {
        const deck = db.ciclo.deck; const idx = deck.indexOf(disc);
        if (idx > -1) { deck.splice(idx, 1); deck.push(disc); saveData(); }
    };

    const renderRevisoesPendentes = () => {
        const list = document.getElementById('revisoes-pendentes-list');
        const today = getTodayDate();
        let html = '';
        db.estudos.forEach(e => {
            if(e.revisoes) e.revisoes.forEach((r, idx) => {
                const rData = r.data.includes('T') ? r.data.split('T')[0] : r.data;
                if(!r.concluida && rData <= today) {
                    html += `<div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid var(--border-color); align-items:center;"><div><strong>${e.disciplina}</strong><br><small style="color:var(--text-light)">${e.assunto} (${idx===0?'1d':idx===1?'7d':'30d'})</small></div><button class="btn-success btn-sm" onclick="openRevisaoModal('${e.id}', ${idx})"><i class="ph ph-check"></i></button></div>`;
                }
            });
        });
        list.innerHTML = html || '<p class="empty-state">Tudo em dia!</p>';
    };

    window.openRevisaoModal = (id, idx) => {
        const e = db.estudos.find(x => x.id === id);
        if (!e) return;
        document.getElementById('rev-id').value = id;
        document.getElementById('rev-idx').value = idx;
        document.getElementById('rev-modal-assunto').textContent = `${e.disciplina} - ${e.assunto}`;
        document.getElementById('rev-tempo').value = '';
        document.getElementById('rev-questoes').value = '';
        document.getElementById('rev-acertos').value = '';
        modalBackdrop.classList.add('active');
        document.getElementById('revisao-modal').classList.add('active');
    };

    const btnSalvarRevisao = document.getElementById('btn-salvar-revisao');
    if(btnSalvarRevisao) {
        btnSalvarRevisao.addEventListener('click', () => {
            const id = document.getElementById('rev-id').value;
            const idx = parseInt(document.getElementById('rev-idx').value);
            const tempo = parseInt(document.getElementById('rev-tempo').value) || 0;
            const questoes = parseInt(document.getElementById('rev-questoes').value) || 0;
            const acertos = parseInt(document.getElementById('rev-acertos').value) || 0;
            const originalStudy = db.estudos.find(x => x.id === id);
            if (originalStudy && originalStudy.revisoes[idx]) {
                originalStudy.revisoes[idx].concluida = true;
                if (questoes > 0) db.estudos.push({ id: Date.now().toString() + '_revQ', data: getTodayDate(), disciplina: originalStudy.disciplina, assunto: originalStudy.assunto + " (Rev)", total: questoes, acertos: acertos, percentual: (acertos/questoes)*100, revisoes: [] });
                if (tempo > 0) db.tempoEstudos.push({ id: Date.now().toString() + '_revT', data: getTodayDate(), disciplina: originalStudy.disciplina, assunto: originalStudy.assunto + " (Rev)", tempoMinutos: tempo, tipo: 'revisao' });
                saveData(); renderHomePage(); modalBackdrop.classList.remove('active'); document.getElementById('revisao-modal').classList.remove('active'); alert("Revisão concluída!");
            }
        });
    }

    // ===== 10. DISCIPLINAS =====

    const renderDisciplinas = () => {
        const list = document.getElementById('disciplinas-list'); list.innerHTML = '';
        if (db.disciplinas.length === 0) { list.innerHTML = '<div class="empty-state">Nenhuma disciplina cadastrada.</div>'; return; }
        db.disciplinas.forEach(d => {
            const assuntosEstudadosSet = new Set([...db.assuntosManuais.filter(m => m.disciplina === d.nome).map(m => m.assunto)]);
            const totalAssuntos = d.assuntos.length; const qtdEstudada = assuntosEstudadosSet.size; const pct = totalAssuntos > 0 ? (qtdEstudada / totalAssuntos) * 100 : 0;
            const div = document.createElement('div'); div.className = 'disciplina-item';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"><h4 style="margin:0">${d.nome}</h4><button class="icon-action-btn btn-trash" onclick="delDisc('${d.id}')" title="Excluir Disciplina"><i class="ph ph-trash"></i></button></div>
                <div style="display:flex; justify-content:space-between; font-size:0.85rem; color:var(--text-light); margin-bottom:5px;"><span>Progresso Concluído</span><span>${qtdEstudada}/${totalAssuntos} (${Math.round(pct)}%)</span></div>
                <div class="progress-bar-bg" style="margin-top:0; margin-bottom:15px;"><div style="width:${pct}%; height:100%; background:var(--success-color); transition: width 0.5s;"></div></div>
                <ul class="assuntos-list">${d.assuntos.map(a => {
                    const isStudied = assuntosEstudadosSet.has(a); const studiedClass = isStudied ? 'studied' : ''; const btnActive = isStudied ? 'active' : ''; const checkTitle = isStudied ? "Desmarcar conclusão" : "Marcar como concluído";
                    const subStudies = db.estudos.filter(e => e.disciplina === d.nome && e.assunto === a);
                    const subTimes = db.tempoEstudos.filter(t => t.disciplina === d.nome && t.assunto === a);
                    const q = subStudies.reduce((acc, e) => acc + e.total, 0); const ac = subStudies.reduce((acc, e) => acc + e.acertos, 0); const perc = q > 0 ? Math.round((ac/q)*100) : 0; const time = subTimes.reduce((acc, t) => acc + t.tempoMinutos, 0);
                    return `<li class="assunto-item ${studiedClass}"><div class="assunto-content"><span>${a}</span></div><div class="assunto-stats">${q > 0 ? `<span class="stat-pill">Q: <strong>${q}</strong></span>` : ''}${q > 0 ? `<span class="stat-pill">Ac: <strong>${ac}</strong></span>` : ''}${q > 0 ? `<span class="stat-pill" style="color:${perc>=80?'var(--success-color)':perc<50?'var(--danger-color)':'var(--warning-color)'}">${perc}%</span>` : ''}${time > 0 ? `<span class="stat-pill"><i class="ph ph-timer"></i> <strong>${time}m</strong></span>` : ''}</div><div class="assunto-actions"><button class="icon-action-btn btn-check-manual ${btnActive}" onclick="toggleManualStudy('${d.nome}', '${a}')" title="${checkTitle}"><i class="ph ph-check"></i></button><button class="icon-action-btn btn-trash" onclick="delAss('${d.id}','${a}')" title="Excluir Assunto"><i class="ph ph-trash"></i></button></div></li>`;
                }).join('')}</ul>
                <form onsubmit="addAssunto(event, '${d.id}')" style="margin-top:15px; display:flex; gap:8px;"><input type="text" placeholder="Adicionar tópico..." required style="padding:8px; flex:1; font-size:0.9rem;"><button class="btn-secondary btn-sm" style="font-weight:bold;"><i class="ph ph-plus"></i></button></form>`;
            list.appendChild(div);
        });
    };

    window.toggleManualStudy = (disciplina, assunto) => {
        const index = db.assuntosManuais.findIndex(m => m.disciplina === disciplina && m.assunto === assunto);
        if (index > -1) { db.assuntosManuais.splice(index, 1); }
        else { db.assuntosManuais.push({ disciplina, assunto }); }
        saveData(); renderDisciplinas(); if(document.getElementById('page-estatisticas').classList.contains('active')) renderEstatisticas();
    };

    window.delDisc = (id) => { if(confirm('Excluir disciplina e histórico?')) { db.disciplinas = db.disciplinas.filter(d=>d.id!==id); saveData(); renderDisciplinas(); }};
    window.delAss = (id, a) => { if(confirm('Excluir assunto?')) { const d=db.disciplinas.find(x=>x.id===id); d.assuntos=d.assuntos.filter(x=>x!==a); saveData(); renderDisciplinas(); }};
    window.addAssunto = (e, id) => { e.preventDefault(); const input = e.target.querySelector('input'); const d = db.disciplinas.find(x => x.id === id); if(d && !d.assuntos.includes(input.value)) { d.assuntos.push(input.value); d.assuntos.sort(); saveData(); renderDisciplinas(); } };

    const btnOpenAddDisc = document.getElementById('btn-open-add-disc');
    if(btnOpenAddDisc) btnOpenAddDisc.addEventListener('click', () => { document.getElementById('new-disc-name').value = ''; document.getElementById('new-disc-subjects').value = ''; modalBackdrop.classList.add('active'); document.getElementById('add-disciplina-modal').classList.add('active'); });
    
    const btnSaveNewDisc = document.getElementById('btn-save-new-disc');
    if(btnSaveNewDisc) btnSaveNewDisc.addEventListener('click', () => {
        const nome = document.getElementById('new-disc-name').value.trim(); const subjectsText = document.getElementById('new-disc-subjects').value;
        if (!nome) return alert("Digite o nome."); if (db.disciplinas.some(d => d.nome.toLowerCase() === nome.toLowerCase())) return alert("Já existe.");
        const assuntosList = subjectsText.split(';').map(s => s.trim()).filter(s => s.length > 0);
        db.disciplinas.push({ id: Date.now().toString(), nome: nome, assuntos: assuntosList }); saveData(); renderDisciplinas(); modalBackdrop.classList.remove('active'); document.getElementById('add-disciplina-modal').classList.remove('active'); alert("Disciplina criada!");
    });

    // ===== 11. CICLO =====

    const renderCicloConfig = () => { const container = document.getElementById('ciclo-disciplinas-selecao'); document.getElementById('config-meta-horas').value = db.ciclo.metaHoras || 4; container.innerHTML = db.disciplinas.map(d => `<div style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border-color); padding:8px; border-radius:6px;"><label style="margin:0">${d.nome}</label><input type="number" class="ciclo-peso" data-nome="${d.nome}" value="1" min="0" max="10" style="width:60px; padding:5px;"></div>`).join(''); renderCicloPreview(); };
    const renderCicloPreview = () => { const list = document.getElementById('ciclo-resultado-list'); const deck = db.ciclo.deck; const porDia = db.ciclo.disciplinasPorDia || 3; if(!deck || deck.length === 0) { list.innerHTML = '<p class="empty-state">Ciclo não gerado.</p>'; return; } let html = ''; for(let i=0; i<deck.length; i+=porDia) { html += `<div style="margin-bottom:10px; padding:10px; background:var(--bg-color); border-radius:6px;"><strong>Bloco ${Math.floor(i/porDia)+1}:</strong> ${deck.slice(i, i+porDia).join(', ')}</div>`; } list.innerHTML = html; };
    
    const btnGerarCiclo = document.getElementById('gerar-ciclo-btn');
    if(btnGerarCiclo) btnGerarCiclo.addEventListener('click', () => { const porDia = parseInt(document.getElementById('ciclo-disciplinas-por-dia').value); const metaHoras = parseInt(document.getElementById('config-meta-horas').value); let deck = []; document.querySelectorAll('.ciclo-peso').forEach(i => { const qtd = parseInt(i.value); for(let k=0; k<qtd; k++) deck.push(i.dataset.nome); }); if(deck.length === 0) return alert("Selecione disciplinas."); for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } db.ciclo = { deck, disciplinasPorDia: porDia, metaHoras: metaHoras }; saveData(); renderCicloFila(); document.getElementById('ciclo-resultado-list').innerHTML = `<p style="padding:10px;">Fila gerada: ${deck.length} itens.</p>`; alert("Nova fila gerada!"); });

    // ===== 12. REGISTRO MANUAL =====

    window.openRegistroModal = (disc = null) => {
        const discSelectGroup = document.getElementById('reg-disciplina-select-group');
        const discSelect = document.getElementById('reg-disciplina-select');
        const discHidden = document.getElementById('reg-disciplina-hidden');
        const modalTitle = document.getElementById('reg-modal-title');
        const finalizadoCheckbox = document.getElementById('reg-finalizado');
        document.getElementById('reg-novo-assunto').value = ''; document.getElementById('reg-questoes').value = ''; document.getElementById('reg-acertos').value = ''; finalizadoCheckbox.checked = false;
        if (disc) {
            discSelectGroup.style.display = 'none'; discHidden.value = disc; modalTitle.textContent = disc; populateRegAssuntos(disc); document.getElementById('reg-tempo').value = '';
        } else {
            discSelectGroup.style.display = 'block'; discSelect.innerHTML = db.disciplinas.map(d => `<option value="${d.nome}">${d.nome}</option>`).join('');
            if (db.disciplinas.length > 0) { discHidden.value = db.disciplinas[0].nome; modalTitle.textContent = db.disciplinas[0].nome; populateRegAssuntos(db.disciplinas[0].nome); } else { modalTitle.textContent = "Sem disciplinas"; populateRegAssuntos(null); }
            discSelect.onchange = (e) => { discHidden.value = e.target.value; modalTitle.textContent = e.target.value; populateRegAssuntos(e.target.value); };
        }
        modalBackdrop.classList.add('active'); document.getElementById('registro-modal').classList.add('active');
    };

    const populateRegAssuntos = (discName) => {
        const select = document.getElementById('reg-assunto-select'); select.innerHTML = '<option value="">Selecione um assunto...</option>'; document.getElementById('reg-novo-assunto').value = '';
        if (!discName) return; const dObj = db.disciplinas.find(d => d.nome === discName); if (dObj && dObj.assuntos.length > 0) { dObj.assuntos.forEach(a => { const opt = document.createElement('option'); opt.value = a; opt.textContent = a; select.appendChild(opt); }); }
    };

    const btnSalvarRegistro = document.getElementById('btn-salvar-registro');
    if(btnSalvarRegistro) btnSalvarRegistro.addEventListener('click', () => {
        const disc = document.getElementById('reg-disciplina-hidden').value; const novoAssunto = document.getElementById('reg-novo-assunto').value.trim(); const assuntoSelecionado = document.getElementById('reg-assunto-select').value; const finalizado = document.getElementById('reg-finalizado').checked;
        let assuntoFinal = ""; if (!disc) return alert("Selecione disciplina.");
        if (novoAssunto) { assuntoFinal = novoAssunto; const dObj = db.disciplinas.find(d => d.nome === disc); if (dObj && !dObj.assuntos.includes(novoAssunto)) { dObj.assuntos.push(novoAssunto); dObj.assuntos.sort(); } } else if (assuntoSelecionado) { assuntoFinal = assuntoSelecionado; }
        if (!assuntoFinal) return alert("Selecione assunto.");
        const totalQ = parseInt(document.getElementById('reg-questoes').value) || 0; const totalA = parseInt(document.getElementById('reg-acertos').value) || 0; const totalT = parseInt(document.getElementById('reg-tempo').value) || 0;
        if (totalA > totalQ) return alert("Acertos > Questões.");
        if (totalQ > 0) { db.estudos.push({ id: Date.now().toString(), data: getTodayDate(), disciplina: disc, assunto: assuntoFinal, total: totalQ, acertos: totalA, percentual: (totalA/totalQ)*100, revisoes: [{data: addDays(getTodayDate(), 1), concluida: false},{data: addDays(getTodayDate(), 7), concluida: false},{data: addDays(getTodayDate(), 30), concluida: false}] }); }
        if (totalT > 0 || totalQ > 0) { db.tempoEstudos.push({ id: Date.now().toString()+'m', data: getTodayDate(), disciplina: disc, assunto: assuntoFinal, tempoMinutos: totalT, tipo: 'manual' }); }
        if (finalizado) { if(!db.assuntosManuais.some(m => m.disciplina === disc && m.assunto === assuntoFinal)) { db.assuntosManuais.push({disciplina: disc, assunto: assuntoFinal}); } }
        rotateCycle(disc); saveData(); modalBackdrop.classList.remove('active'); document.getElementById('registro-modal').classList.remove('active'); renderHomePage(); alert("Salvo!");
    });

    // ===== 13. TIMER =====

    const initTimerDOM = () => {
        const display = document.getElementById('timer-display'); const btnToggle = document.getElementById('timer-toggle-btn'); const btnReset = document.getElementById('timer-reset-btn');
        const btnTransfer = document.getElementById('timer-transfer-btn'); const containerSave = document.getElementById('timer-save-container'); const phases = document.querySelectorAll('.phase-badge');
        const btnOpenTimer = document.getElementById('btn-open-timer-main'); const miniDisplay = document.getElementById('mini-timer-display');
        
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
        if(btnTransfer) btnTransfer.addEventListener('click', () => { const mins = Math.ceil(timer.accumulated / 60); if(mins < 1) return alert("Tempo curto."); modalBackdrop.classList.remove('active'); document.getElementById('timer-modal').classList.remove('active'); openRegistroModal(null); document.getElementById('reg-tempo').value = mins; containerSave.style.display = 'none'; timer.accumulated = 0; if(timer.mode === 'livre' && btnReset) btnReset.click(); });
    };

    // ===== 14. ESTATÍSTICAS =====

    const renderEstatisticas = () => {
        const dFiltro = document.getElementById('filter-disciplina').value; const ini = document.getElementById('filter-data-inicio').value; const fim = document.getElementById('filter-data-fim').value;
        const estudosF = db.estudos.filter(e => { const dNome = db.disciplinas.find(d=>d.id===dFiltro)?.nome; return (dFiltro === 'todas' || e.disciplina === dNome) && (!ini || e.data >= ini) && (!fim || e.data <= fim); });
        const tempoF = db.tempoEstudos.filter(t => { const dNome = db.disciplinas.find(d=>d.id===dFiltro)?.nome; return (dFiltro === 'todas' || t.disciplina === dNome) && (!ini || t.data >= ini) && (!fim || t.data <= fim); });
        const totMin = tempoF.reduce((a,b) => a + b.tempoMinutos, 0); document.getElementById('stat-total-horas').textContent = formatDuration(totMin);
        let totQ = 0, totA = 0; estudosF.forEach(e => { totQ += e.total; totA += e.acertos; }); document.getElementById('stat-total-questoes').textContent = totQ; document.getElementById('stat-media-geral').textContent = totQ > 0 ? `${Math.round((totA/totQ)*100)}%` : '0%';
        renderCharts(estudosF, tempoF); renderHistorico(estudosF);
    };
    const renderCharts = (estudos, tempos) => {
        const labels = db.disciplinas.map(d => d.nome); const textColor = document.body.dataset.theme === 'dark' ? '#f0f0f0' : '#333'; 
        if(typeof Chart !== 'undefined') Chart.defaults.color = textColor;
        const dataAcertos = labels.map(label => { const es = estudos.filter(e => e.disciplina === label); let q=0, a=0; es.forEach(x => { q+=x.total; a+=x.acertos; }); return q>0 ? (a/q)*100 : 0; });
        const dataTempo = labels.map(label => { const ts = tempos.filter(t => t.disciplina === label); return (ts.reduce((acc,c)=>acc+c.tempoMinutos,0) / 60).toFixed(1); });
        const dataCob = labels.map(label => { const d = db.disciplinas.find(x => x.nome === label); if(!d) return 0; const uniqueStudied = new Set([...db.estudos.filter(e=>e.disciplina===label).map(e=>e.assunto), ...db.tempoEstudos.filter(t=>t.disciplina===label).map(t=>t.assunto), ...db.assuntosManuais.filter(m=>m.disciplina===label).map(m=>m.assunto)]); return d.assuntos.length > 0 ? (uniqueStudied.size / d.assuntos.length)*100 : 0; });
        const commonOpts = { responsive:true, maintainAspectRatio: false };
        if(charts.acertos) charts.acertos.destroy(); 
        if(document.getElementById('chart-acertos')) charts.acertos = new Chart(document.getElementById('chart-acertos'), { type: 'bar', data: { labels, datasets: [{ label: '% Acerto', data: dataAcertos, backgroundColor: '#4f46e5' }] }, options: { ...commonOpts, scales: { y: { beginAtZero: true, max: 100 } } } });
        if(charts.tempo) charts.tempo.destroy(); 
        if(document.getElementById('chart-tempo')) charts.tempo = new Chart(document.getElementById('chart-tempo'), { type: 'bar', data: { labels, datasets: [{ label: 'Horas', data: dataTempo, backgroundColor: '#8b5cf6' }] }, options: { ...commonOpts, indexAxis: 'y' } });
        if(charts.cobertura) charts.cobertura.destroy(); 
        if(document.getElementById('chart-cobertura')) charts.cobertura = new Chart(document.getElementById('chart-cobertura'), { type: 'bar', data: { labels, datasets: [{ label: '% Concluído', data: dataCob, backgroundColor: '#22c55e' }] }, options: { ...commonOpts, indexAxis: 'y', scales: { x: { max: 100 } } } });
    };
    const renderHistorico = (estudos) => {
        const container = document.getElementById('stat-historico-revisoes'); if(estudos.length === 0) { container.innerHTML = '<p class="empty-state">Sem dados.</p>'; return; }
        container.innerHTML = estudos.slice().reverse().slice(0, 20).map(e => { const dataF = formatDateBr(e.data); return `<div style="padding:10px; border-bottom:1px solid var(--border-color);"><strong>${e.disciplina}</strong> - ${e.assunto}<br><small>${e.acertos}/${e.total} acertos (${Math.round(e.percentual)}%) em ${dataF}</small></div>`; }).join('');
    };

    // ===== 15. INICIALIZAÇÃO E UTILITÁRIOS =====

    document.querySelectorAll('.modal-close-btn').forEach(b => b.addEventListener('click', () => { modalBackdrop.classList.remove('active'); document.querySelectorAll('.modal').forEach(m => m.classList.remove('active')); }));
    document.getElementById('theme-toggle').addEventListener('click', () => { const t = document.body.dataset.theme==='dark'?'light':'dark'; document.body.dataset.theme=t; localStorage.setItem('studyAppTheme', t); });
    const updateSelects = () => { const select = document.getElementById('filter-disciplina'); if(select) {const opts = db.disciplinas.map(d => `<option value="${d.id}">${d.nome}</option>`).join(''); select.innerHTML = '<option value="todas">Todas</option>' + opts;} };
    const elConfigMeta = document.getElementById('config-meta-horas');
    if(elConfigMeta) elConfigMeta.addEventListener('change', (e) => { const val = parseInt(e.target.value); if(val > 0) { db.ciclo.metaHoras = val; saveData(); } });

    // Inicia verificando auth e DOM do timer
    checkAuth();
    initTimerDOM();
});