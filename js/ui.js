import { 
    store,
    saveDrillsToStorage,
    lastPlayedDrill,
} from './state.js';
import { Drill } from './model/index.js';
import { bleState } from './bluetooth.js';
import { showToast } from './utils.js'; 
import { openEditor } from './editor.js';

// --- Handle Create New Drill ---
window.handleCreateNewDrill = (cat) => {
    if (store.count(cat) >= 100) {
        showToast("Category is full (Max 100)");
        return;
    }

    const newName = prompt("Enter Name for New Drill:");
    if (!newName) return;
    if (newName.length > 40) { showToast("Name too long (Max 40)"); return; }
    if (!/^[a-zA-Z0-9.\-#\[\]><\+\)\( ]+$/.test(newName)) { showToast("Invalid characters"); return; }

    const def = new Drill(newName, { steps: [], random: false });
    store.add(cat, def);
    saveDrillsToStorage();

    renderDrillButtons();
    showToast(`Created ${newName}`);
    openEditor(cat, store.count(cat) - 1);
};

// --- NEW: Drag & Drop to Tab Handlers ---

window.allowTabDrop = (e) => {
    e.preventDefault(); 
};

window.handleTabDrop = (e, targetCat) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const [srcCat, srcIdx] = data.split(':');
    const idx = parseInt(srcIdx);

    if (!srcCat || isNaN(idx)) return;
    if (srcCat === targetCat) return;
    
    if (store.count(targetCat) >= 100) {
        showToast(`Bank ${targetCat.replace('data', '')} is full!`);
        return;
    }

    const drill = store.remove(srcCat, idx);
    if (!drill) return;
    store.add(targetCat, drill);

    saveDrillsToStorage();
    renderDrillButtons(); 
    showToast(`Moved to ${targetCat.replace('data', '')}`);
    
    const targetBtn = document.querySelector(`.tab-btn[onclick*="${targetCat}"]`);
    if(targetBtn) switchTab(targetCat, targetBtn);
};

// --- EXISTING UI LOGIC ---

export function renderDrillButtons() {
    ['dataA', 'dataB', 'dataC'].forEach(cat => {
        const container = document.getElementById(`view-${cat}`);
        if (!container) return;
        container.innerHTML = '';
        
        store.get(cat).forEach((drill, i) => {
            createButton(container, cat, i, drill);
        });

        const addWrapper = document.createElement('div');
        addWrapper.style.cssText = "width:100%; display:flex; justify-content:center; margin:15px 0 10px 0;";

        const addBtn = document.createElement('button');
        addBtn.className = 'btn-swap'; 
        addBtn.style.cssText = "width:40px; height:40px; color:var(--primary); border-color:var(--primary); font-size:1.2rem; box-shadow:0 2px 5px rgba(0,0,0,0.1);";
        addBtn.title = "Create New Drill";
        
        addBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        `;
        
        addBtn.onclick = () => window.handleCreateNewDrill(cat);
        
        addWrapper.appendChild(addBtn);
        container.appendChild(addWrapper);
    });

    updateLastPlayedHighlight();
}

export function updateLastPlayedHighlight() {
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('last-played'));
    
    if (lastPlayedDrill) {
        const btn = document.querySelector(`.btn-drill[data-key="${lastPlayedDrill}"]`);
        if (btn) btn.classList.add('last-played');
    }
}

function createButton(container, cat, index, drill) {
    const key = `${cat}:${index}`;
    const btn = document.createElement('button');
    btn.className = 'btn-drill';
    btn.dataset.key = key;
    
    const iconDiv = document.createElement('div');
    iconDiv.className = 'drill-icon';
    for(let i=0; i<4; i++) {
        iconDiv.appendChild(document.createElement('div')).className = 'd-dot';
    }
    btn.appendChild(iconDiv);

    const span = document.createElement('span');
    span.textContent = drill.name;
    btn.appendChild(span);

    if (drill.random) {
        const rMark = document.createElement('div');
        rMark.className = 'mark-random';
        rMark.textContent = 'R';
        btn.appendChild(rMark);
    }
    
    const grip = document.createElement('div');
    grip.className = 'drill-grab-handle';
    grip.innerHTML = '≡'; 
    grip.title = "Drag to reorder";
    
    btn.draggable = false; 

    const enableDrag = () => { btn.draggable = true; };
    const disableDrag = () => { btn.draggable = false; };

    grip.addEventListener('mousedown', enableDrag);
    grip.addEventListener('touchstart', enableDrag, {passive: true});
    grip.addEventListener('mouseup', disableDrag);
    grip.addEventListener('mouseleave', disableDrag);
    grip.addEventListener('touchend', disableDrag);

    btn.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key); 
        btn.classList.add('dragging');
    });

    btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        btn.draggable = false; 
        handleReorder(container, cat);
    });
    
    btn.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        const draggingItem = container.querySelector('.dragging');
        if (draggingItem && draggingItem !== btn) {
            const box = btn.getBoundingClientRect();
            const offset = e.clientY - box.top - (box.height / 2);
            if (offset < 0) {
                container.insertBefore(draggingItem, btn);
            } else {
                container.insertBefore(draggingItem, btn.nextSibling);
            }
        }
    });

    grip.onclick = (e) => e.stopPropagation();
    btn.appendChild(grip);

    // Edit button (pencil)
    const editBtn = document.createElement('div');
    editBtn.className = 'drill-edit-btn';
    editBtn.innerHTML = '✎';
    editBtn.title = 'Edit drill';
    editBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    editBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    editBtn.onclick = (e) => { e.stopPropagation(); openEditor(cat, index); };
    btn.appendChild(editBtn);

    // Run button (play icon)
    const runBtn = document.createElement('div');
    runBtn.className = 'drill-run-btn';
    runBtn.innerHTML = '&#9654;';
    runBtn.title = 'Run drill';
    runBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    runBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    runBtn.onclick = (e) => {
        e.stopPropagation();
        if (!btn.classList.contains('dragging')) window.handleDrillClick(cat, index, drill.name, btn);
    };
    btn.appendChild(runBtn);

    container.appendChild(btn);
}

function handleReorder(container, cat) {
    const buttons = Array.from(container.querySelectorAll('.btn-drill'));
    const newOrder = buttons.map(b => {
        const [c, i] = b.dataset.key.split(':');
        return parseInt(i);
    });
    
    const list = store.get(cat);
    if(newOrder.length === list.length) {
        const reordered = newOrder.map(i => list[i]).filter(Boolean);
        store.setCat(cat, reordered);
    }
}

export function updateDrillButtonStates() {
    const btns = document.querySelectorAll('.btn-drill');
    btns.forEach(b => {
         b.style.opacity = bleState.isConnected ? "1" : "0.6"; 
    });
    
    const btnConnect = document.getElementById('btn-connect');
    const statusText = document.getElementById('status-text');
    
    if (btnConnect && statusText) {
        if (bleState.isConnected) {
            btnConnect.textContent = "Disconnect";
            btnConnect.classList.add('connected');
            statusText.textContent = "Connected";
            statusText.style.color = "#00b894";
        } else {
            btnConnect.textContent = "Connect";
            btnConnect.classList.remove('connected');
            statusText.textContent = "Disconnected";
            statusText.style.color = "var(--text-light)";
        }
    }
}

export function toggleMenu() {
    const m = document.getElementById('theme-menu');
    if(m) m.classList.toggle('open');
}

export function setTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('nova_theme_pref', themeName);
    toggleMenu();
}

export function switchTab(catName, btn) {
    const tabs = ['dataA','dataB','dataC'];
    tabs.forEach(c => {
        const el = document.getElementById('view-'+c);
        if(el) el.classList.add('hidden');
    });
    const target = document.getElementById('view-' + catName);
    if(target) target.classList.remove('hidden');
    
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    if(btn) btn.classList.add('active');
}

function formatDrillName(key) {
    if (key.startsWith('cust_')) return key; 
    return key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// --- NEW: About Modal Handlers ---
window.openAboutModal = () => {
    // Close menu first if open
    const menu = document.getElementById('theme-menu');
    if(menu) menu.classList.remove('open');
    
    const m = document.getElementById('about-modal');
    if(m) m.classList.add('open');
};

window.closeAboutModal = () => {
    const m = document.getElementById('about-modal');
    if(m) m.classList.remove('open');
};

