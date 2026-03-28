// js/timer.js

export let timerState = {
    interval: null, running: false, mode: 'pomodoro', phase: 'focus',
    seconds: 1500, accumulated: 0, settings: { focus: 25, short: 5, long: 15 }
};

export const initTimerDOM = (openRegistroModalCallback) => {
    const audioAlarm = document.getElementById('timer-sound');
    const display = document.getElementById('timer-display'); 
    const btnToggle = document.getElementById('timer-toggle-btn'); 
    const btnReset = document.getElementById('timer-reset-btn');
    const btnTransfer = document.getElementById('timer-transfer-btn'); 
    const containerSave = document.getElementById('timer-save-container'); 
    const phases = document.querySelectorAll('.phase-badge');
    const btnOpenTimer = document.getElementById('btn-open-timer-main'); 
    const miniDisplay = document.getElementById('mini-timer-display');
    const modalBackdrop = document.getElementById('modal-backdrop');
    
    if(btnOpenTimer) {
        btnOpenTimer.addEventListener('click', () => { 
            modalBackdrop.classList.add('active'); 
            document.getElementById('timer-modal').classList.add('active'); 
        });
    }
    
    const updateDisplay = () => { 
        const m = Math.floor(timerState.seconds / 60); 
        const s = timerState.seconds % 60; 
        const timeStr = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        
        if(display) display.textContent = timeStr; 
        
        if (timerState.running) { 
            if(miniDisplay) { miniDisplay.textContent = timeStr; miniDisplay.style.color = '#fff'; } 
            document.title = `${timeStr} - Foco`; 
        } else { 
            if(miniDisplay) { miniDisplay.textContent = "Iniciar"; miniDisplay.style.color = '#fff'; } 
            document.title = 'StudyApp'; 
        }
        
        phases.forEach(p => p.classList.remove('active')); 
        if(timerState.mode === 'pomodoro') { 
            document.querySelector(`.phase-badge[data-phase="${timerState.phase}"]`)?.classList.add('active'); 
        }
    };

    const playAlarm = () => { 
        if(audioAlarm) { 
            audioAlarm.currentTime = 0; 
            audioAlarm.play().catch(e => console.log("Permissão de áudio necessária")); 
        } 
    };

    const tick = () => { 
        if(timerState.mode === 'pomodoro') {
            if(timerState.seconds > 0) { 
                timerState.seconds--; 
                if(timerState.phase === 'focus') timerState.accumulated++; 
            } else { 
                timerState.running = false; 
                clearInterval(timerState.interval); 
                btnToggle.innerHTML = '<i class="ph ph-play"></i> Iniciar'; 
                playAlarm(); 
                alert("Tempo esgotado!"); 
                if(timerState.accumulated > 0) containerSave.style.display = 'block';
                
                if(timerState.phase === 'focus') { 
                    timerState.phase = 'short'; timerState.seconds = timerState.settings.short * 60; 
                } else { 
                    timerState.phase = 'focus'; timerState.seconds = timerState.settings.focus * 60; 
                }
            }
        } else { 
            timerState.seconds++; 
            timerState.accumulated++; 
        }
        updateDisplay(); 
    };

    if(btnToggle) {
        btnToggle.addEventListener('click', () => { 
            if(timerState.running) { 
                clearInterval(timerState.interval); 
                timerState.running = false; 
                btnToggle.innerHTML = '<i class="ph ph-play"></i> Retomar'; 
                if(timerState.accumulated > 60) containerSave.style.display = 'block'; 
            } else { 
                timerState.interval = setInterval(tick, 1000); 
                timerState.running = true; 
                btnToggle.innerHTML = '<i class="ph ph-pause"></i> Pausar'; 
                containerSave.style.display = 'none'; 
            } 
            updateDisplay();
        });
    }

    if(btnReset) {
        btnReset.addEventListener('click', () => { 
            clearInterval(timerState.interval); 
            timerState.running = false; 
            if(timerState.mode === 'pomodoro') { 
                timerState.seconds = timerState.settings.focus * 60; 
                timerState.phase = 'focus'; 
            } else { 
                timerState.seconds = 0; 
            }
            timerState.accumulated = 0; 
            btnToggle.innerHTML = '<i class="ph ph-play"></i> Iniciar'; 
            containerSave.style.display = 'none'; 
            updateDisplay(); 
        });
    }

    document.querySelectorAll('.mode-btn').forEach(btn => { 
        btn.addEventListener('click', () => { 
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active')); 
            btn.classList.add('active'); 
            timerState.mode = btn.dataset.mode; 
            const phasesContainer = document.getElementById('pomodoro-phases'); 
            if(timerState.mode === 'livre') phasesContainer.style.visibility = 'hidden'; 
            else phasesContainer.style.visibility = 'visible';
            if(btnReset) btnReset.click(); 
        }); 
    });

    if(btnTransfer) {
        btnTransfer.addEventListener('click', () => { 
            const mins = Math.ceil(timerState.accumulated / 60); 
            if(mins < 1) return alert("Tempo muito curto para registrar."); 
            
            modalBackdrop.classList.remove('active'); 
            document.getElementById('timer-modal').classList.remove('active'); 
            
            // Chama a função que abrirá o modal lá no arquivo de UI
            if (openRegistroModalCallback) openRegistroModalCallback(null); 
            
            setTimeout(() => {
                document.getElementById('reg-tempo').value = mins; 
            }, 100);

            containerSave.style.display = 'none'; 
            timerState.accumulated = 0; 
            if(timerState.mode === 'livre' && btnReset) btnReset.click(); 
        });
    }
};