// js/ui.js
import { db, currentEditalId, getCurrentEdital, getTodayDate, formatDateBr, formatDuration, getTaskNumber, escapeQuotes, filterStudiesByEdital, isLegacyRegistration, setIsLegacyRegistration, isSaving, setIsSaving, addDays } from './state.js';
import { apiSaveData, apiSaveIncremental, apiUpdateRevisionStatus } from './api.js';
import { calculateStreakStats, renderHeatmap, renderEstatisticas } from './stats.js';
import { renderFlashcardsDashboard } from './flashcards.js';

export const updateEditalUI = () => {
    const edital = getCurrentEdital();
    const editalSelector = document.getElementById('edital-selector');
    const navEditalSelector = document.getElementById('navbar-edital-select');
    const fillSelect = (el) => {
        if(!el) return;
        if (db.editais.length === 0) el.innerHTML = '<option value="">Nenhum Edital</option>';
        else el.innerHTML = db.editais.map(e => `<option value="${e.id}" ${e.id === currentEditalId ? 'selected' : ''}>${e.nome}</option>`).join('');
    };
    fillSelect(editalSelector); fillSelect(navEditalSelector);
    
    const currentEditalLabel = document.getElementById('current-edital-label');
    if (currentEditalLabel) currentEditalLabel.textContent = edital ? edital.nome : 'Nenhum edital selecionado';

    const btnAddDisc = document.getElementById('btn-open-add-disc');
    if(btnAddDisc && edital) {
        const novoBtn = btnAddDisc.cloneNode(true);
        btnAddDisc.parentNode.replaceChild(novoBtn, btnAddDisc);
        const modalBackdrop = document.getElementById('modal-backdrop');
        
        if(edital.isTrilha) {
            novoBtn.innerHTML = '<i class="ph ph-folders"></i> Importar Aulas';
            novoBtn.classList.replace('btn-primary', 'btn-secondary'); 
            novoBtn.addEventListener('click', () => {
                document.getElementById('trilha-csv-input').value = '';
                modalBackdrop.classList.add('active'); document.getElementById('import-trilha-modal').classList.add('active');
            });
        } else {
            novoBtn.innerHTML = '<i class="ph ph-plus"></i> Nova Disciplina';
            novoBtn.classList.replace('btn-secondary', 'btn-primary');
            novoBtn.addEventListener('click', () => {
                document.getElementById('new-disc-name').value = ''; document.getElementById('new-disc-subjects').value = '';
                const label = document.getElementById('add-disc-edital-name'); if(label) label.textContent = edital.nome;
                modalBackdrop.classList.add('active'); document.getElementById('add-disciplina-modal').classList.add('active');
            });
        }
    }
};

export const showPage = (pageId) => {
    const pages = document.querySelectorAll('.page');
    const navLinks = document.querySelectorAll('.nav-link');
    const sidebar = document.getElementById('sidebar');

    pages.forEach(p => p.classList.remove('active'));
    navLinks.forEach(l => { l.classList.remove('active'); if (l.dataset.page === pageId) l.classList.add('active'); });
    
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

export const renderHomePage = () => {
    const edital = getCurrentEdital();
    updateSummaries(edital);
    if (!edital) {
        document.getElementById('ciclo-hoje-list').innerHTML = '<p class="empty-state">Selecione ou crie um edital para começar.</p>';
        document.getElementById('revisoes-pendentes-list').innerHTML = '<p class="empty-state">-</p>';
        document.getElementById('dashboard-table-body').innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Nenhum edital ativo.</td></tr>';
        renderHeatmap(); calculateStreakStats(); return;
    }
    renderCicloFila(edital); renderRevisoesPendentes(edital); renderHeatmap(); calculateStreakStats(); renderDashboardTable(edital); renderEditalGlobalProgress(edital); 
};

const renderEditalGlobalProgress = (edital) => {
    const elBar = document.getElementById('dash-edital-progress'); const elPerc = document.getElementById('dash-edital-perc');
    if (!elBar || !elPerc) return;
    if (!edital) { elBar.style.width = '0%'; elPerc.textContent = '0%'; return; }

    let totalAssuntos = 0; let concluidos = 0;
    edital.disciplinas.forEach(d => {
        if (!d.assuntos) d.assuntos = []; totalAssuntos += d.assuntos.length;
        const concluidosDisc = db.assuntosManuais.filter(m => m && m.disciplina === d.nome && m.assunto && d.assuntos.includes(m.assunto) && (!m.editalId || m.editalId === edital.id)).length;
        concluidos += concluidosDisc;
    });

    const percentual = totalAssuntos > 0 ? Math.round((concluidos / totalAssuntos) * 100) : 0;
    elBar.style.width = `${percentual}%`; elPerc.textContent = `${percentual}%`;
};

const updateSummaries = (edital) => {
    const today = getTodayDate();
    const metaHoras = (edital && edital.ciclo && edital.ciclo.metaHoras) ? edital.ciclo.metaHoras : 4;
    if (!edital) {
        document.getElementById('dash-meta-horas').textContent = `0h 0m / ${metaHoras}h`;
        document.getElementById('dash-tempo').textContent = "0h 0m";
        document.getElementById('dash-acertos').textContent = "-"; document.getElementById('dash-revisoes').textContent = "0"; return;
    }

    const temposEdital = filterStudiesByEdital(db.tempoEstudos);
    const minsHoje = temposEdital.filter(t => {
        if(!t || !t.data || t.data === 'SEM_DATA') return false;
        return (t.data.includes('T') ? t.data.split('T')[0] : t.data) === today;
    }).reduce((acc, c) => acc + (Number(c.tempoMinutos) || 0), 0);

    const h = Math.floor(minsHoje / 60); const m = minsHoje % 60;
    document.getElementById('dash-meta-horas').textContent = `${h}h ${m}m / ${metaHoras}h`;
    document.getElementById('dash-tempo').textContent = formatDuration(minsHoje);

    const estudosEdital = filterStudiesByEdital(db.estudos);
    let q = 0, a = 0;
    estudosEdital.filter(e => {
        if(!e || !e.data || e.data === 'SEM_DATA') return false;
        return (e.data.includes('T') ? e.data.split('T')[0] : e.data) === today && e.disciplina !== 'Flashcards';
    }).forEach(e => { q += (Number(e.total) || 0); a += (Number(e.acertos) || 0); });
    
    document.getElementById('dash-acertos').textContent = q > 0 ? `${Math.round((a/q)*100)}%` : '-';

    let pends = 0;
    estudosEdital.forEach(e => {
        if(e && e.revisoes) e.revisoes.forEach(r => { 
            if(!r || !r.data || r.data === 'SEM_DATA') return;
            if(!r.concluida && (r.data.includes('T') ? r.data.split('T')[0] : r.data) <= today) pends++; 
        });
    });
    document.getElementById('dash-revisoes').textContent = pends;
};

const renderDashboardTable = (edital) => {
    const tbody = document.getElementById('dashboard-table-body');
    if (!tbody) return; tbody.innerHTML = '';
    if (!edital || edital.disciplinas.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-light)">Nenhuma disciplina neste edital.</td></tr>'; return; }
    
    const estudosFiltrados = filterStudiesByEdital(db.estudos);
    const temposFiltrados = filterStudiesByEdital(db.tempoEstudos);

    edital.disciplinas.forEach(d => {
        const studies = estudosFiltrados.filter(e => e && e.disciplina === d.nome);
        const times = temposFiltrados.filter(t => t && t.disciplina === d.nome);
        const totalQ = studies.reduce((acc, e) => acc + (Number(e.total) || 0), 0);
        const totalA = studies.reduce((acc, e) => acc + (Number(e.acertos) || 0), 0);
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

export const renderCicloConfig = () => {
    const edital = getCurrentEdital();
    const selecao = document.getElementById('ciclo-disciplinas-selecao');
    if (!edital) { selecao.innerHTML = '<p class="empty-state">Selecione ou crie um edital primeiro.</p>'; document.getElementById('ciclo-resultado-list').innerHTML = ''; return; }
    if(!edital.ciclo) edital.ciclo = { deck: [], disciplinasPorDia: 3, metaHoras: 4, pesos: {} };
    if(!edital.ciclo.pesos) edital.ciclo.pesos = {};

    document.getElementById('config-meta-horas').value = edital.ciclo.metaHoras || 4;
    document.getElementById('ciclo-disciplinas-por-dia').value = edital.ciclo.disciplinasPorDia || 3;

    let htmlSel = '';
    edital.disciplinas.forEach(d => {
        const peso = edital.ciclo.pesos[d.nome] || 1;
        htmlSel += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"><label style="flex:1;">${d.nome}</label><div style="display:flex; align-items:center; gap:10px;"><span style="font-size:0.8rem; color:var(--text-light);">Peso:</span><input type="number" min="0" value="${peso}" data-disc="${escapeQuotes(d.nome)}" class="peso-input" style="width:70px;"></div></div>`;
    });
    selecao.innerHTML = htmlSel || '<p class="empty-state">Adicione disciplinas ao edital primeiro.</p>';
    renderFilaCicloAtual();
};

const renderFilaCicloAtual = () => {
    const edital = getCurrentEdital();
    const resultado = document.getElementById('ciclo-resultado-list');
    if (!edital || !edital.ciclo || !edital.ciclo.deck || edital.ciclo.deck.length === 0) { resultado.innerHTML = '<p class="empty-state">Ciclo não gerado ou vazio.</p>'; return; }
    resultado.innerHTML = edital.ciclo.deck.map((d, i) => `<div style="padding:10px; border-bottom:1px solid var(--border-color); display:flex; gap:10px; align-items:center;"><strong style="color:var(--primary-color)">${i+1}º</strong> ${d}</div>`).join('');
};

export const renderDisciplinas = () => {
    const list = document.getElementById('disciplinas-list');
    if (!list) return;
    const edital = getCurrentEdital();
    if (!edital || !edital.disciplinas || edital.disciplinas.length === 0) { list.innerHTML = '<p class="empty-state">Nenhuma disciplina cadastrada neste edital.</p>'; return; }

    let html = '';
    edital.disciplinas.forEach((d, index) => {
        const assuntos = d.assuntos || [];
        const concluidos = db.assuntosManuais.filter(m => m.disciplina === d.nome && m.editalId === edital.id && assuntos.includes(m.assunto));
        const perc = assuntos.length > 0 ? Math.round((concluidos.length / assuntos.length) * 100) : 0;

        let assuntosHtml = '<ul class="assuntos-list">';
        
        if (edital.isTrilha) {
            const groups = {};
            const ungrouped = [];
            
            assuntos.forEach(a => {
                const firstDash = a.indexOf(' - ');
                if (firstDash > 0) {
                    const groupName = a.substring(0, firstDash).trim();
                    const displayText = a.substring(firstDash + 3).trim();
                    if (!groups[groupName]) groups[groupName] = [];
                    groups[groupName].push({ original: a, display: displayText });
                } else {
                    ungrouped.push({ original: a, display: a });
                }
            });

            const renderItem = (item, isGrouped) => {
                const isConcluido = concluidos.some(c => c.assunto === item.original);
                const safeDisc = escapeQuotes(d.nome); const safeAssunto = escapeQuotes(item.original);
                const stylePadding = isGrouped ? 'padding-left: 20px; border-left: 2px solid var(--border-color); margin-left: 8px;' : '';
                
                return `<li class="assunto-item ${isConcluido ? 'studied' : ''}" style="${stylePadding}">
                    <div class="assunto-content">${item.display}</div>
                    <div class="assunto-actions">
                        <button class="icon-action-btn btn-check-manual ${isConcluido ? 'active' : ''}" onclick="toggleAssuntoConcluido('${safeDisc}', '${safeAssunto}')" title="Marcar como concluído"><i class="ph ph-check-circle"></i></button>
                        <button class="icon-action-btn" style="color:var(--primary-color)" onclick="openRegistroModal('${safeDisc}', '${safeAssunto}', true)" title="Registrar Estudo"><i class="ph ph-book-open"></i></button>
                        <button class="icon-action-btn" style="color:var(--text-light)" onclick="editAssunto('${safeDisc}', '${safeAssunto}')" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                        <button class="icon-action-btn btn-trash" onclick="removeAssunto('${safeDisc}', '${safeAssunto}')" title="Remover"><i class="ph ph-trash"></i></button>
                    </div>
                </li>`;
            };

            for (const [group, items] of Object.entries(groups)) {
                assuntosHtml += `<div style="font-weight: 600; color: var(--primary-color); padding: 12px 0 6px 0; border-bottom: 1px solid var(--border-color); margin-bottom: 5px;"><i class="ph ph-folder-open"></i> ${group}</div>`;
                items.forEach(item => assuntosHtml += renderItem(item, true));
            }
            ungrouped.forEach(item => assuntosHtml += renderItem(item, false));

        } else {
            assuntos.forEach(a => {
                const isConcluido = concluidos.some(c => c.assunto === a);
                const safeDisc = escapeQuotes(d.nome); const safeAssunto = escapeQuotes(a);
                assuntosHtml += `<li class="assunto-item ${isConcluido ? 'studied' : ''}">
                    <div class="assunto-content">${a}</div>
                    <div class="assunto-actions">
                        <button class="icon-action-btn btn-check-manual ${isConcluido ? 'active' : ''}" onclick="toggleAssuntoConcluido('${safeDisc}', '${safeAssunto}')" title="Marcar como concluído">
                            <i class="ph ph-check-circle"></i>
                        </button>
                        <button class="icon-action-btn" style="color:var(--primary-color)" onclick="openRegistroModal('${safeDisc}', '${safeAssunto}', true)" title="Registrar Estudo neste assunto">
                            <i class="ph ph-book-open"></i>
                        </button>
                        <button class="icon-action-btn" style="color:var(--text-light)" onclick="editAssunto('${safeDisc}', '${safeAssunto}')" title="Editar nome do assunto">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="icon-action-btn btn-trash" onclick="removeAssunto('${safeDisc}', '${safeAssunto}')" title="Remover assunto">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </li>`;
            });
        }
        
        assuntosHtml += '</ul>';

        html += `<div class="disciplina-item">
            <div style="display:flex; justify-content:space-between; align-items:center; cursor: pointer; user-select: none;" onclick="toggleDisciplinaContent(${index})">
                <h4 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i class="ph ph-caret-right" id="icon-disc-${index}"></i> ${d.nome}
                </h4>
                <div style="display:flex; gap: 5px;" onclick="event.stopPropagation()">
                    <button class="btn-secondary btn-sm" onclick="editDisciplina('${escapeQuotes(d.nome)}')"><i class="ph ph-pencil-simple"></i> Editar</button>
                    <button class="btn-danger btn-sm" onclick="removeDisciplina('${escapeQuotes(d.nome)}')"><i class="ph ph-trash"></i> Remover</button>
                </div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-top:10px;">
                <span>Progresso</span><strong style="color:var(--primary-color)">${perc}% (${concluidos.length}/${assuntos.length})</strong>
            </div>
            <div class="progress-bar-bg"><div style="width: ${perc}%; height: 100%; background: var(--primary-color);"></div></div>
            
            <div id="content-disc-${index}" style="display: none; margin-top: 15px; animation: fadeIn 0.3s ease-out;">
                ${assuntosHtml}
                <div style="margin-top:15px; display:flex; gap:10px;">
                    <input type="text" id="new-assunto-input-${index}" placeholder="Novo assunto..." style="flex:1;">
                    <button class="btn-secondary" onclick="addAssuntoRapido('${escapeQuotes(d.nome)}', ${index})"><i class="ph ph-plus"></i> Add</button>
                </div>
            </div>
        </div>`;
    });
    list.innerHTML = html;
};

// --- Funções atreladas à UI/Window ---

export const editDisciplina = (oldName) => {
    const edital = getCurrentEdital();
    if(!edital) return;
    const novoNome = prompt("Digite o novo nome da disciplina:", oldName);
    if(!novoNome || novoNome.trim() === "" || novoNome === oldName) return;

    if(edital.disciplinas.some(d => d.nome.toLowerCase() === novoNome.trim().toLowerCase())) {
        return alert("Já existe uma disciplina com esse nome neste edital.");
    }

    const dObj = edital.disciplinas.find(d => d.nome === oldName);
    if(dObj) dObj.nome = novoNome.trim();

    db.assuntosManuais.forEach(m => { if(m.disciplina === oldName && m.editalId === edital.id) m.disciplina = novoNome.trim(); });
    db.estudos.forEach(e => { if(e.disciplina === oldName && e.editalId === edital.id) e.disciplina = novoNome.trim(); });
    db.tempoEstudos.forEach(t => { if(t.disciplina === oldName && t.editalId === edital.id) t.disciplina = novoNome.trim(); });

    if (edital.ciclo) {
        if(edital.ciclo.deck) edital.ciclo.deck = edital.ciclo.deck.map(x => x === oldName ? novoNome.trim() : x);
        if(edital.ciclo.pesos && edital.ciclo.pesos[oldName] !== undefined) {
            edital.ciclo.pesos[novoNome.trim()] = edital.ciclo.pesos[oldName];
            delete edital.ciclo.pesos[oldName];
        }
    }

    apiSaveData(db); renderDisciplinas();
};

export const editAssunto = (discName, oldAssunto) => {
    const edital = getCurrentEdital();
    if(!edital) return;
    const novoAssunto = prompt("Digite o novo nome do assunto:", oldAssunto);
    if(!novoAssunto || novoAssunto.trim() === "" || novoAssunto === oldAssunto) return;

    const dObj = edital.disciplinas.find(d => d.nome === discName);
    if(dObj) {
        if(dObj.assuntos.includes(novoAssunto.trim())) return alert("Esse assunto já existe nesta disciplina.");
        const idx = dObj.assuntos.indexOf(oldAssunto);
        if(idx > -1) dObj.assuntos[idx] = novoAssunto.trim();
    }

    db.assuntosManuais.forEach(m => { if(m.disciplina === discName && m.assunto === oldAssunto && m.editalId === edital.id) m.assunto = novoAssunto.trim(); });
    db.estudos.forEach(e => { if(e.disciplina === discName && e.assunto === oldAssunto && e.editalId === edital.id) e.assunto = novoAssunto.trim(); });
    db.tempoEstudos.forEach(t => { if(t.disciplina === discName && t.assunto === oldAssunto && t.editalId === edital.id) t.assunto = novoAssunto.trim(); });

    apiSaveData(db); renderDisciplinas();
};

export const toggleAssuntoConcluido = (discName, assunto) => {
    const edital = getCurrentEdital(); if(!edital) return;
    const idx = db.assuntosManuais.findIndex(m => m.disciplina === discName && m.assunto === assunto && m.editalId === edital.id);
    if(idx > -1) db.assuntosManuais.splice(idx, 1);
    else db.assuntosManuais.push({disciplina: discName, assunto: assunto, editalId: edital.id}); 
    apiSaveData(db); renderDisciplinas();
    if(document.getElementById('page-home').classList.contains('active')) renderHomePage();
};

export const removeAssunto = (discName, assunto) => {
    if(!confirm(`Remover assunto "${assunto}"?`)) return;
    const edital = getCurrentEdital(); if(!edital) return;
    const d = edital.disciplinas.find(x => x.nome === discName);
    if(d) {
        d.assuntos = d.assuntos.filter(a => a !== assunto);
        db.assuntosManuais = db.assuntosManuais.filter(m => !(m.disciplina === discName && m.assunto === assunto && m.editalId === edital.id));
        apiSaveData(db); renderDisciplinas();
    }
};

export const removeDisciplina = (discName) => {
    if(!confirm(`Excluir disciplina "${discName}" e todos os seus assuntos?`)) return;
    const edital = getCurrentEdital(); if(!edital) return;
    edital.disciplinas = edital.disciplinas.filter(d => d.nome !== discName);
    db.assuntosManuais = db.assuntosManuais.filter(m => !(m.disciplina === discName && m.editalId === edital.id));
    if (edital.ciclo && edital.ciclo.deck) edital.ciclo.deck = edital.ciclo.deck.filter(x => x !== discName);
    apiSaveData(db); renderDisciplinas();
};

export const addAssuntoRapido = (discName, index) => {
    const input = document.getElementById(`new-assunto-input-${index}`); const novo = input.value.trim(); if(!novo) return;
    const edital = getCurrentEdital(); if(!edital) return;
    const d = edital.disciplinas.find(x => x.nome === discName);
    if(d) { if(!d.assuntos.includes(novo)) { d.assuntos.push(novo); d.assuntos.sort(); } input.value = ''; apiSaveData(db); renderDisciplinas(); }
};

export const openRegistroModal = (disc = null, assuntoPreSelecionado = null, fromListClick = false) => {
    const edital = getCurrentEdital(); if (!edital) return alert("Crie um edital primeiro!");
    const discSelectGroup = document.getElementById('reg-disciplina-select-group'); const discSelect = document.getElementById('reg-disciplina-select');
    const discHidden = document.getElementById('reg-disciplina-hidden'); const modalTitle = document.getElementById('reg-modal-title');
    const finalizadoCheckbox = document.getElementById('reg-finalizado'); const revisoesCheckbox = document.getElementById('reg-agendar-revisoes'); 
    const dataInput = document.getElementById('reg-data-input'); const semDataCheckbox = document.getElementById('reg-sem-data');
    
    document.getElementById('reg-novo-assunto').value = ''; document.getElementById('reg-inicio').value = ''; document.getElementById('reg-fim').value = '';
    document.getElementById('reg-questoes').value = ''; document.getElementById('reg-acertos').value = ''; document.getElementById('reg-tempo').value = '';
    finalizadoCheckbox.checked = !!assuntoPreSelecionado; if(revisoesCheckbox) revisoesCheckbox.checked = true;
    dataInput.value = getTodayDate(); dataInput.disabled = false; semDataCheckbox.checked = false;
    
    setIsLegacyRegistration(fromListClick); 
    semDataCheckbox.onchange = (e) => { dataInput.disabled = e.target.checked; };

    const populateRegAssuntos = (discName) => {
        const select = document.getElementById('reg-assunto-select'); select.innerHTML = '<option value="">Selecione um assunto...</option>'; document.getElementById('reg-novo-assunto').value = '';
        if (!discName) return; 
        const dObj = edital.disciplinas.find(d => d.nome.toLowerCase() === discName.toLowerCase()); 
        if (dObj && dObj.assuntos.length > 0) dObj.assuntos.forEach(a => { const opt = document.createElement('option'); opt.value = a; opt.textContent = a; select.appendChild(opt); }); 
    };

    if (disc) {
        discSelectGroup.style.display = 'none'; discHidden.value = disc; modalTitle.textContent = disc; populateRegAssuntos(disc); 
        if(assuntoPreSelecionado) {
            const select = document.getElementById('reg-assunto-select');
            if(!Array.from(select.options).some(o => o.value === assuntoPreSelecionado)) { const opt = document.createElement('option'); opt.value = assuntoPreSelecionado; opt.textContent = assuntoPreSelecionado; select.appendChild(opt); }
            select.value = assuntoPreSelecionado;
        }
    } else {
        discSelectGroup.style.display = 'block'; discSelect.innerHTML = edital.disciplinas.map(d => `<option value="${d.nome}">${d.nome}</option>`).join('');
        if (edital.disciplinas.length > 0) { discHidden.value = edital.disciplinas[0].nome; modalTitle.textContent = edital.disciplinas[0].nome; populateRegAssuntos(edital.disciplinas[0].nome); } 
        else { modalTitle.textContent = "Sem disciplinas"; populateRegAssuntos(null); }
        discSelect.onchange = (e) => { discHidden.value = e.target.value; modalTitle.textContent = e.target.value; populateRegAssuntos(e.target.value); };
    }
    document.getElementById('modal-backdrop').classList.add('active'); document.getElementById('registro-modal').classList.add('active');
};

const rotateCycle = (disc) => {
    const edital = getCurrentEdital(); if(!edital || !edital.ciclo || !edital.ciclo.deck) return;
    const deck = edital.ciclo.deck; const idx = deck.indexOf(disc);
    if (idx > -1) { deck.splice(idx, 1); deck.push(disc); }
};

const renderCicloFila = (edital) => {
    const container = document.getElementById('ciclo-hoje-list');
    if(!edital || !edital.ciclo) { container.innerHTML = '<p class="empty-state">Sem edital ativo.</p>'; return; }
    const deck = edital.ciclo.deck || []; const limit = edital.ciclo.disciplinasPorDia || 3;
    if (deck.length === 0) { container.innerHTML = '<p class="empty-state">Ciclo vazio. Configure na aba Ciclo.</p>'; return; }
    
    container.innerHTML = deck.slice(0, limit).map((disc, index) => {
        const today = getTodayDate();
        const studiedToday = db.tempoEstudos.some(t => {
            if(!t || !t.data || t.data === 'SEM_DATA') return false;
            return (t.data.includes('T') ? t.data.split('T')[0] : t.data) === today && t.disciplina === disc && t.tipo !== 'revisao' && (!t.editalId || t.editalId === edital.id);
        });
        const statusIcon = studiedToday ? '<i class="ph ph-check-circle" style="color:var(--success-color)"></i>' : '<i class="ph ph-books"></i>';
        
        let sugestaoAssunto = "Todos concluídos!"; const dObj = edital.disciplinas.find(d => d.nome === disc);
        if (dObj && dObj.assuntos && dObj.assuntos.length > 0) {
            const pendentes = dObj.assuntos.filter(a => !db.assuntosManuais.some(m => m && m.disciplina === disc && m.assunto === a && (!m.editalId || m.editalId === edital.id)));
            if (pendentes.length > 0) { if (edital.isTrilha) pendentes.sort((a, b) => getTaskNumber(a) - getTaskNumber(b)); sugestaoAssunto = pendentes[0]; }
        } else if (dObj && (!dObj.assuntos || dObj.assuntos.length === 0)) sugestaoAssunto = "Sem assuntos cadastrados";

        const safeDisc = escapeQuotes(disc); const safeAssunto = (sugestaoAssunto !== "Todos concluídos!" && sugestaoAssunto !== "Sem assuntos cadastrados") ? escapeQuotes(sugestaoAssunto) : '';
        return `<div class="ciclo-item-card"><div class="ciclo-info"><h4>${statusIcon} ${disc}</h4><div style="font-size:0.85rem; color:var(--text-light); margin-left:24px; display:flex; align-items:center; gap:5px;"><i class="ph ph-arrow-elbow-down-right"></i> <strong style="color:var(--primary-color)">${sugestaoAssunto}</strong></div></div><div class="ciclo-actions"><button class="action-btn btn-manual-action" onclick="openRegistroModal('${safeDisc}', '${safeAssunto}')"><span><i class="ph ph-pencil-simple"></i></span> Registrar</button></div></div>`;
    }).join('');
};

const renderRevisoesPendentes = (edital) => {
    const list = document.getElementById('revisoes-pendentes-list'); if(!edital) return;
    const today = getTodayDate(); const estudosEdital = filterStudiesByEdital(db.estudos);
    let html = '';
    estudosEdital.forEach(e => {
        if(e && e.revisoes) e.revisoes.forEach((r, idx) => {
            if(!r || !r.data || r.data === 'SEM_DATA') return;
            if(!r.concluida && (r.data.includes('T') ? r.data.split('T')[0] : r.data) <= today) {
                const infoIntervalo = e.intervalo ? `<div style="font-size:0.8rem; color:var(--primary-color); margin-top:2px;"><i class="ph ph-bookmark-simple"></i> ${e.intervalo}</div>` : '';
                
                // Aplicando as labels táticas para as revisões pendentes
                const revLabels = ['1d (Flashcards)', '3d (Leitura Ativa)', '7d (Questões)', '15d (Manutenção)', '30d (Manutenção)'];
                const rLabel = idx < 5 ? revLabels[idx] : `+30d (Repetição)`;

                html += `<div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid var(--border-color); align-items:center;"><div><strong>${e.disciplina}</strong><br><small style="color:var(--text-light)">${e.assunto} (${rLabel})</small>${infoIntervalo}</div><button class="btn-success btn-sm" onclick="openRevisaoModal('${e.id}', ${idx})"><i class="ph ph-check"></i></button></div>`;
            }
        });
    });
    list.innerHTML = html || '<p class="empty-state">Tudo em dia!</p>';
};

export const openRevisaoModal = (id, idx) => {
    const e = db.estudos.find(x => x.id === id); if (!e) return;
    document.getElementById('rev-id').value = id; document.getElementById('rev-idx').value = idx;
    const textoIntervalo = e.intervalo ? ` (Faixa: ${e.intervalo})` : '';
    document.getElementById('rev-modal-assunto').textContent = `${e.disciplina} - ${e.assunto}${textoIntervalo}`;
    document.getElementById('rev-tempo').value = ''; document.getElementById('rev-questoes').value = ''; document.getElementById('rev-acertos').value = '';
    document.getElementById('modal-backdrop').classList.add('active'); document.getElementById('revisao-modal').classList.add('active');
};

export const salvarRegistro = async (btn) => {
    if(isSaving) return; setIsSaving(true);
    const originalText = btn.textContent; btn.textContent = "A processar..."; btn.disabled = true;

    try {
        const disc = document.getElementById('reg-disciplina-hidden').value; 
        const novoAssunto = document.getElementById('reg-novo-assunto').value.trim(); 
        const assuntoSelecionado = document.getElementById('reg-assunto-select').value; 
        const finalizado = document.getElementById('reg-finalizado').checked;
        const agendarRevisoes = document.getElementById('reg-agendar-revisoes').checked; 
        const edital = getCurrentEdital();
        const semData = document.getElementById('reg-sem-data').checked;
        let dataRegistro = semData ? 'SEM_DATA' : (document.getElementById('reg-data-input').value || getTodayDate());

        if (!disc) throw new Error("USER_ERROR:Selecione a disciplina.");
        
        const pgInicio = document.getElementById('reg-inicio').value.trim();
        const pgFim = document.getElementById('reg-fim').value.trim();
        let intervaloStr = null; if(pgInicio || pgFim) intervaloStr = `${pgInicio || '?'} até ${pgFim || '?'}`;

        let assuntoFinal = ""; 
        if (novoAssunto) { 
            assuntoFinal = novoAssunto; const dObj = edital.disciplinas.find(d => d.nome === disc); 
            if (dObj && !dObj.assuntos.includes(novoAssunto)) { dObj.assuntos.push(novoAssunto); dObj.assuntos.sort(); } 
        } else if (assuntoSelecionado) assuntoFinal = assuntoSelecionado;
        if (!assuntoFinal) throw new Error("USER_ERROR:Selecione o assunto.");
        
        const inputQ = document.getElementById('reg-questoes').value; const inputA = document.getElementById('reg-acertos').value; const inputT = document.getElementById('reg-tempo').value;
        const totalQ = inputQ ? parseInt(inputQ) : 0; const totalA = inputA ? parseInt(inputA) : 0; const totalT = inputT ? parseInt(inputT) : 0;
        
        if (totalA > totalQ) throw new Error("USER_ERROR:O número de acertos não pode ser maior que as questões.");
        
        // NOVO: Array base das 5 revisões (1, 3, 7, 15, 30)
        let revisoesArray = [];
        if (agendarRevisoes) {
            revisoesArray = [
                {data: addDays(dataRegistro, 1), concluida: false},
                {data: addDays(dataRegistro, 3), concluida: false},
                {data: addDays(dataRegistro, 7), concluida: false},
                {data: addDays(dataRegistro, 15), concluida: false},
                {data: addDays(dataRegistro, 30), concluida: false}
            ];
        }

        const novoEstudo = { id: Date.now().toString(), editalId: edital.id, data: dataRegistro, disciplina: disc, assunto: assuntoFinal, intervalo: intervaloStr, total: totalQ, acertos: totalA, percentual: totalQ > 0 ? (totalA/totalQ)*100 : 0, tempo: totalT, revisoes: revisoesArray }; 
        let novoTempo = null;
        if (totalT > 0 || totalQ > 0 || finalizado) novoTempo = { id: Date.now().toString()+'m', editalId: edital.id, data: dataRegistro, disciplina: disc, assunto: assuntoFinal, tempoMinutos: Number(totalT), tipo: 'manual' }; 
        
        db.estudos.push(novoEstudo); if (novoTempo) db.tempoEstudos.push(novoTempo);
        let precisaSalvarDBCompleto = false;

        if (finalizado && !db.assuntosManuais.some(m => m.disciplina === disc && m.assunto === assuntoFinal && m.editalId === edital.id)) { db.assuntosManuais.push({disciplina: disc, assunto: assuntoFinal, editalId: edital.id}); precisaSalvarDBCompleto = true; }
        if (novoAssunto) precisaSalvarDBCompleto = true;
        if (!isLegacyRegistration) { rotateCycle(disc); precisaSalvarDBCompleto = true; }
        
        document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('registro-modal').classList.remove('active'); 
        renderHomePage(); renderDisciplinas(); 
        if(document.getElementById('page-estatisticas').classList.contains('active')) renderEstatisticas();
        if(document.getElementById('page-ciclo').classList.contains('active')) renderCicloConfig();
        
        try {
            await apiSaveIncremental({ estudo: novoEstudo, tempo: novoTempo });
            if (precisaSalvarDBCompleto) await apiSaveData(db);
            setTimeout(() => alert("Salvo com sucesso!"), 100);
        } catch(apiErr) { console.error(apiErr); setTimeout(() => alert("Registo guardado localmente (Erro de ligação com o servidor)."), 100); }

    } catch (e) {
        if(e.message && e.message.startsWith("USER_ERROR:")) alert(e.message.split(":")[1]);
        else { console.error(e); alert("Ocorreu um erro interno. Verifique a consola."); }
    } finally { btn.textContent = originalText; btn.disabled = false; setIsSaving(false); }
};

export const salvarRevisao = async (btn) => {
    if(isSaving) return; setIsSaving(true);
    const originalText = btn.textContent; btn.textContent = "A processar..."; btn.disabled = true;

    try {
        const id = document.getElementById('rev-id').value; const idx = parseInt(document.getElementById('rev-idx').value);
        const tempo = parseInt(document.getElementById('rev-tempo').value) || 0;
        const questoes = parseInt(document.getElementById('rev-questoes').value) || 0;
        const acertos = parseInt(document.getElementById('rev-acertos').value) || 0;
        
        const originalStudy = db.estudos.find(x => x.id === id); if (!originalStudy) throw new Error("USER_ERROR:Estudo original não encontrado.");

        originalStudy.revisoes[idx].concluida = true;
        
        // NOVO: Gatilho automático para manter as repetições a cada 30 dias após a primeira do ciclo
        if (idx >= 4 && idx === originalStudy.revisoes.length - 1) {
            originalStudy.revisoes.push({
                data: addDays(getTodayDate(), 30),
                concluida: false
            });
        }

        const editalIdRef = originalStudy.editalId || currentEditalId;
        let novoEstudoRev = null; let novoTempoRev = null;

        if (questoes > 0) { novoEstudoRev = { id: Date.now().toString() + '_revQ', editalId: editalIdRef, data: getTodayDate(), disciplina: originalStudy.disciplina, assunto: originalStudy.assunto, total: questoes, acertos: acertos, percentual: questoes > 0 ? (acertos/questoes)*100 : 0, tempo: tempo, revisoes: [] }; db.estudos.push(novoEstudoRev); }
        if (tempo > 0) { novoTempoRev = { id: Date.now().toString() + '_revT', editalId: editalIdRef, data: getTodayDate(), disciplina: originalStudy.disciplina, assunto: originalStudy.assunto, tempoMinutos: tempo, tipo: 'revisao' }; db.tempoEstudos.push(novoTempoRev); }

        document.getElementById('modal-backdrop').classList.remove('active'); document.getElementById('revisao-modal').classList.remove('active'); 
        renderHomePage(); renderDisciplinas(); if(document.getElementById('page-estatisticas').classList.contains('active')) renderEstatisticas();

        try {
            if (novoEstudoRev || novoTempoRev) await apiSaveIncremental({ estudo: novoEstudoRev, tempo: novoTempoRev });
            await apiUpdateRevisionStatus(id, idx); await apiSaveData(db); 
            setTimeout(() => alert("Revisão concluída com sucesso!"), 100);
        } catch(e) { console.error(e); setTimeout(() => alert("Revisão guardada localmente (Erro de rede)."), 100); }

    } catch (e) {
        if(e.message && e.message.startsWith("USER_ERROR:")) alert(e.message.split(":")[1]);
        else { console.error(e); alert("Ocorreu um erro interno ao guardar a revisão."); }
    } finally { btn.textContent = originalText; btn.disabled = false; setIsSaving(false); }
};

export const toggleDisciplinaContent = (index) => {
    const content = document.getElementById(`content-disc-${index}`);
    const icon = document.getElementById(`icon-disc-${index}`);
    if (!content) return;
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        if (icon) icon.classList.replace('ph-caret-right', 'ph-caret-down');
    } else {
        content.style.display = 'none';
        if (icon) icon.classList.replace('ph-caret-down', 'ph-caret-right');
    }
};

window.openRegistroModal = openRegistroModal;
window.openRevisaoModal = openRevisaoModal;
window.toggleAssuntoConcluido = toggleAssuntoConcluido;
window.removeAssunto = removeAssunto;
window.removeDisciplina = removeDisciplina;
window.addAssuntoRapido = addAssuntoRapido;
window.toggleDisciplinaContent = toggleDisciplinaContent;