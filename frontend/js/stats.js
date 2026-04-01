// js/stats.js
import { db, charts, getTodayDate, diffInDays, addDays, formatDuration, formatDateBr, getCurrentEdital, filterStudiesByEdital } from './state.js';

export const calculateStreakStats = () => {
    const rawDates = new Set([ 
        ...db.estudos.filter(e => e && e.data && e.data !== 'SEM_DATA').map(e => e.data), 
        ...db.tempoEstudos.filter(t => t && t.data && t.data !== 'SEM_DATA').map(t => t.data) 
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
        if (e && e.disciplina !== 'Flashcards') {
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
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: totalQ > 0 } } }
        });
    }
};

export const renderHeatmap = () => {
    const container = document.getElementById('heatmap-container');
    if (!container) return; container.innerHTML = '';
    
    const dataMap = {};
    db.tempoEstudos.forEach(t => { 
        if(!t || !t.data || t.data === 'SEM_DATA') return;
        const d = t.data.includes('T') ? t.data.split('T')[0] : t.data;
        if(!dataMap[d]) dataMap[d] = { minutes: 0, count: 0 };
        dataMap[d].minutes += (Number(t.tempoMinutos) || 0);
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

export const renderEstatisticas = () => {
    const edital = getCurrentEdital();
    if (!edital) return; 

    const dFiltro = document.getElementById('filter-disciplina').value; 
    const ini = document.getElementById('filter-data-inicio').value; 
    const fim = document.getElementById('filter-data-fim').value;
    
    const baseEstudos = filterStudiesByEdital(db.estudos);
    const baseTempos = filterStudiesByEdital(db.tempoEstudos);

    const estudosF = baseEstudos.filter(e => { 
        if (!e || !e.data || e.data === 'SEM_DATA') return false;
        const eData = e.data.includes('T') ? e.data.split('T')[0] : e.data; 
        return (dFiltro === 'todas' || e.disciplina === dFiltro) && (!ini || eData >= ini) && (!fim || eData <= fim); 
    });
    
    const tempoF = baseTempos.filter(t => { 
        if (!t || !t.data || t.data === 'SEM_DATA') return false;
        const tData = t.data.includes('T') ? t.data.split('T')[0] : t.data;
        return (dFiltro === 'todas' || t.disciplina === dFiltro) && (!ini || tData >= ini) && (!fim || tData <= fim); 
    });
    
    const totMin = tempoF.reduce((a,b) => a + (Number(b.tempoMinutos) || 0), 0); 
    document.getElementById('stat-total-horas').textContent = formatDuration(totMin);
    
    let totQ = 0, totA = 0; 
    estudosF.forEach(e => { 
        if (e.disciplina !== 'Flashcards') { totQ += (Number(e.total) || 0); totA += (Number(e.acertos) || 0); }
    }); 
    document.getElementById('stat-total-questoes').textContent = totQ; 
    document.getElementById('stat-media-geral').textContent = totQ > 0 ? `${Math.round((totA/totQ)*100)}%` : '0%';
    
    renderCharts(edital, estudosF, tempoF); 
    renderHistorico(estudosF, ini, fim);
};

const renderCharts = (edital, estudos, tempos) => {
    const labels = edital.disciplinas.map(d => d.nome); 
    const textColor = document.body.dataset.theme === 'dark' ? '#f0f0f0' : '#333'; 
    if(typeof Chart !== 'undefined') Chart.defaults.color = textColor;
    
    const dataAcertos = labels.map(label => { 
        const es = estudos.filter(e => e && e.disciplina === label); 
        let q=0, a=0; es.forEach(x => { q+=(Number(x.total)||0); a+=(Number(x.acertos)||0); }); 
        return q>0 ? (a/q)*100 : 0; 
    });
    
    const dataTempo = labels.map(label => { 
        const ts = tempos.filter(t => t && t.disciplina === label); 
        return (ts.reduce((acc,c)=>acc+(Number(c.tempoMinutos)||0),0) / 60).toFixed(1); 
    });
    
    const dataCob = labels.map(label => { 
        const d = edital.disciplinas.find(x => x.nome === label); if(!d) return 0; 
        const uniqueStudied = new Set([
            ...estudos.filter(e=>e && e.disciplina===label).map(e=>e.assunto), 
            ...tempos.filter(t=>t && t.disciplina===label).map(t=>t.assunto), 
            ...db.assuntosManuais.filter(m=>m && m.disciplina===label && (!m.editalId || m.editalId === edital.id)).map(m=>m.assunto)
        ]); 
        const arrLen = d.assuntos ? d.assuntos.length : 0;
        return arrLen > 0 ? (uniqueStudied.size / arrLen)*100 : 0; 
    });

    const dynamicHeight = Math.max(300, labels.length * 35);
    ['chart-acertos', 'chart-tempo', 'chart-cobertura'].forEach(id => {
        const el = document.getElementById(id); if(el && el.parentElement) el.parentElement.style.height = `${dynamicHeight}px`;
    });

    const commonOpts = { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, y: { grid: { display: false }, ticks: { autoSkip: false } } }, plugins: { legend: { display: false } } };
    
    if(charts.acertos) charts.acertos.destroy(); 
    if(document.getElementById('chart-acertos')) charts.acertos = new Chart(document.getElementById('chart-acertos'), { type: 'bar', data: { labels, datasets: [{ label: '% Acerto', data: dataAcertos, backgroundColor: '#4f46e5' }] }, options: { ...commonOpts, scales: { ...commonOpts.scales, x: { ...commonOpts.scales.x, max: 100 } } } });
    if(charts.tempo) charts.tempo.destroy(); 
    if(document.getElementById('chart-tempo')) charts.tempo = new Chart(document.getElementById('chart-tempo'), { type: 'bar', data: { labels, datasets: [{ label: 'Horas', data: dataTempo, backgroundColor: '#8b5cf6' }] }, options: commonOpts });
    if(charts.cobertura) charts.cobertura.destroy(); 
    if(document.getElementById('chart-cobertura')) charts.cobertura = new Chart(document.getElementById('chart-cobertura'), { type: 'bar', data: { labels, datasets: [{ label: '% Concluído', data: dataCob, backgroundColor: '#22c55e' }] }, options: { ...commonOpts, scales: { ...commonOpts.scales, x: { ...commonOpts.scales.x, max: 100 } } } });
};

const renderHistorico = (estudos, dataInicio, dataFim) => {
    const container = document.getElementById('stat-historico-revisoes'); 
    if(estudos.length === 0) { container.innerHTML = '<p class="empty-state">Sem dados neste período.</p>'; return; }
    
    const sortedEstudos = estudos.slice().sort((a, b) => {
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
            const concluidas = e.revisoes.filter(r => r && r.concluida).length;
            const statusColor = concluidas === total ? 'var(--success-color)' : 'var(--warning-color)';
            
            // NOVO: Labels alinhados à estratégia de 1/3/7/15/30+
            const revLabels = ['1d', '3d', '7d', '15d', '30d'];
            
            const revDetails = e.revisoes.map((r, i) => {
                if (!r) return '';
                const label = i < 5 ? revLabels[i] : '+30d';
                const icon = r.concluida ? '✓' : '○';
                const style = r.concluida ? 'color:var(--success-color); font-weight:bold;' : 'color:var(--text-light);';
                return `<span style="${style} margin-right:5px; font-size:0.75rem;">[${icon}] ${label}</span>`;
            }).join('');
            revBadge = `<div style="margin-top:5px; font-size:0.8rem;"><strong style="color:${statusColor}; font-size:0.75rem; text-transform:uppercase; margin-right:5px;">Revisões:</strong>${revDetails}</div>`;
        }

        const desempenho = e.total > 0 
            ? `${e.acertos}/${e.total} acertos (<strong style="color:${e.percentual>=80?'var(--success-color)':e.percentual<50?'var(--danger-color)':'var(--warning-color)'}">${Math.round(e.percentual)}%</strong>)` 
            : `<span style="color:var(--secondary-color); font-style:italic;">Estudo Teórico / Leitura</span>`;
        const htmlIntervalo = e.intervalo ? `<div style="font-size:0.8rem; color:var(--secondary-color);"><i class="ph ph-bookmark-simple"></i> ${e.intervalo}</div>` : '';

        return `
        <div style="padding:12px; border-bottom:1px solid var(--border-color); display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between;"><span style="font-weight:600; color:var(--text-color);">${e.disciplina}</span><span style="font-size:0.8rem; color:var(--text-light);">${dataF}</span></div>
            <div style="color:var(--text-color); font-size:0.9rem;">${e.assunto}</div>${htmlIntervalo}
            <div style="font-size:0.85rem; color:var(--text-light);">${desempenho}</div>${revBadge}
        </div>`; 
    }).join('');
    
    if (sortedEstudos.length > displayLimit) container.innerHTML += `<div style="text-align:center; padding:15px; color:var(--text-light); font-size:0.9rem; font-style:italic;">Exibindo os ${displayLimit} últimos registros. Use os filtros de data para ver mais antigos.</div>`;
};

export const generatePDF = () => {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) return alert("Erro: Biblioteca PDF não carregada.");
    const edital = getCurrentEdital();
    if (!edital) return alert("Selecione um edital.");
    const dFiltro = document.getElementById('filter-disciplina').value; 
    const ini = document.getElementById('filter-data-inicio').value; 
    const fim = document.getElementById('filter-data-fim').value;

    const baseEstudos = filterStudiesByEdital(db.estudos);
    const estudosF = baseEstudos.filter(e => { 
        if (!e || !e.data || e.data === 'SEM_DATA') return false;
        const eData = e.data.includes('T') ? e.data.split('T')[0] : e.data;
        return (dFiltro === 'todas' || e.disciplina === dFiltro) && (!ini || eData >= ini) && (!fim || eData <= fim); 
    }).sort((a, b) => new Date(b.data) - new Date(a.data));

    if(estudosF.length === 0) return alert("Nenhum registro encontrado com os filtros atuais.");

    const doc = new jsPDF();
    doc.setFontSize(18); doc.text(`Relatório de Estudos - ${edital.nome}`, 14, 20);
    doc.setFontSize(10); doc.text(`Gerado em: ${new Date().toLocaleDateString()} | Filtro: ${dFiltro === 'todas' ? 'Todas Disciplinas' : dFiltro}`, 14, 28);

    const tableBody = estudosF.map(e => [
        formatDateBr(e.data), e.disciplina, e.assunto, e.intervalo || "-", e.tempo ? formatDuration(e.tempo) : "-", e.total > 0 ? `${e.acertos}/${e.total} (${Math.round(e.percentual)}%)` : "-",
    ]);

    doc.autoTable({ startY: 35, head: [['Data', 'Disciplina', 'Assunto', 'Intervalo', 'Tempo', 'Desempenho']], body: tableBody, theme: 'striped', headStyles: { fillColor: [79, 70, 229] } });
    doc.save(`relatorio_estudos_${getTodayDate()}.pdf`);
};