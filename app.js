// The canonical 75 Hard task list. Used to seed a new challenge and to
// "Reset to defaults". Habits are data-driven from here on, so the UI can
// add / edit / delete / reorder them freely.
const DEFAULT_HABITS = [
    { id: 'diet', title: 'Follow Your Diet', description: 'No cheat meals, no alcohol', type: 'check' },
    { id: 'workout1', title: 'Workout #1', description: '45 minutes, any type', type: 'check' },
    { id: 'workout2', title: 'Workout #2', description: '45 minutes, outdoors', type: 'check' },
    { id: 'water', title: 'Drink Water', description: '1 gallon (128 oz)', type: 'check' },
    { id: 'reading', title: 'Read 10 Pages', description: 'Non-fiction, educational', type: 'check' },
    { id: 'squats', title: 'Squat Protocol', description: 'Daily squat holds for posture', type: 'check' },
    { id: 'pushups', title: '50 Push-ups', description: 'Can be broken into sets', type: 'check' },
    { id: 'abholds', title: '3+ Min Ab Holds', description: 'Plank or hollow body holds', type: 'check' },
    { id: 'weights', title: 'Weight Training', description: 'Evening strength session', type: 'check' },
    { id: 'study', title: '1 Hour Study', description: 'CILA exam preparation', type: 'check' },
    { id: 'photo', title: 'Progress Photo', description: 'Daily transformation pic', type: 'photo' }
];

function defaultHabits() {
    return DEFAULT_HABITS.map(h => ({ ...h }));
}

// Build a fresh "today" task map (all unchecked) from a habits list.
function buildTasks(habits) {
    const tasks = {};
    habits.forEach(h => { tasks[h.id] = false; });
    return tasks;
}

// Initialize app state.
// NOTE: `photos` is an in-memory cache only — the actual image data lives in
// IndexedDB (see photo-store below) so it never bloats the localStorage blob
// that holds the critical state. This is what fixes the "stuck on a day" bug:
// previously multi-MB base64 photos overflowed localStorage's ~5MB quota and
// every saveState() threw, silently blocking the day counter.
let appState = {
    currentDay: 1,
    startDate: null,
    habits: defaultHabits(),
    tasks: buildTasks(DEFAULT_HABITS),
    dailyProgress: {},
    photos: {},
    attempts: []
};

/* ------------------------------------------------------------------ */
/* Photo storage (IndexedDB) — large quota, kept out of localStorage   */
/* ------------------------------------------------------------------ */
const PHOTO_DB = '75hard-photos';
const PHOTO_STORE = 'photos';
let _photoDbPromise = null;

function openPhotoDb() {
    if (_photoDbPromise) return _photoDbPromise;
    _photoDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
        const req = indexedDB.open(PHOTO_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(PHOTO_STORE)) {
                db.createObjectStore(PHOTO_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _photoDbPromise;
}

function photoTx(mode, fn) {
    return openPhotoDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE, mode);
        const store = tx.objectStore(PHOTO_STORE);
        const result = fn(store);
        tx.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    }));
}

function photoSet(day, dataUrl) {
    return photoTx('readwrite', store => store.put(dataUrl, String(day)));
}

function photoDelete(day) {
    return photoTx('readwrite', store => store.delete(String(day)));
}

function photoClearAll() {
    return photoTx('readwrite', store => store.clear());
}

// Load every saved photo into the in-memory appState.photos cache.
function photoGetAll() {
    return openPhotoDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE, 'readonly');
        const store = tx.objectStore(PHOTO_STORE);
        const out = {};
        const req = store.openCursor();
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) { out[cursor.key] = cursor.value; cursor.continue(); }
            else resolve(out);
        };
        req.onerror = () => reject(req.error);
    }));
}

// Hydrate the in-memory photo cache from IndexedDB, then refresh photo UI.
async function hydratePhotos() {
    try {
        appState.photos = await photoGetAll();
    } catch (e) {
        console.error('Could not load photos', e);
        appState.photos = appState.photos || {};
    }
    refreshPhotoUI();
}

// Downscale a captured image so it stays small (~100-300KB) instead of the
// multi-MB originals phones produce. Returns a JPEG data URL.
function downscaleImage(file, maxSize = 1280, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > height && width > maxSize) {
                    height = Math.round(height * (maxSize / width));
                    width = maxSize;
                } else if (height > maxSize) {
                    width = Math.round(width * (maxSize / height));
                    height = maxSize;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                try {
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (err) {
                    resolve(e.target.result); // fall back to original if canvas is tainted
                }
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Load saved state from localStorage
function loadState() {
    const saved = localStorage.getItem('75hard-state');
    if (!saved) return;

    let migratePhotos = null;
    try {
        const parsed = JSON.parse(saved);

        // Migration: older versions stored photos inside the state blob (the
        // cause of the quota bug). Pull them out so we can move them to IDB.
        if (parsed.photos && Object.keys(parsed.photos).length) {
            migratePhotos = parsed.photos;
        }
        parsed.photos = {};

        // Migration: older versions had no habits list. Seed it from defaults.
        if (!Array.isArray(parsed.habits) || parsed.habits.length === 0) {
            parsed.habits = defaultHabits();
        }
        if (!parsed.tasks || typeof parsed.tasks !== 'object') {
            parsed.tasks = buildTasks(parsed.habits);
        }

        appState = parsed;
    } catch (e) {
        console.error('Could not parse saved state', e);
        return;
    }

    // Recovery: if the current day is already marked completed (possible with
    // legacy half-saved state from the old quota bug), advance past it so the
    // user isn't stranded on a finished day.
    if (appState.dailyProgress[appState.currentDay]?.completed && appState.currentDay < 75) {
        appState.currentDay++;
        resetDailyTasks();
        saveState();
    }

    // Move any legacy in-state photos into IndexedDB, then drop them from
    // localStorage by re-saving the (now photo-free) state.
    if (migratePhotos) {
        Object.keys(migratePhotos).forEach(day => {
            photoSet(day, migratePhotos[day]).catch(err => console.error('photo migrate failed', err));
        });
        saveState();
    }

    updateUI();
}

// Save the critical state to localStorage. Photos are intentionally excluded
// (they live in IndexedDB), keeping this blob tiny. Wrapped so a storage
// failure can never throw and abort callers like endDay().
function saveState() {
    try {
        const { photos, ...persist } = appState;
        localStorage.setItem('75hard-state', JSON.stringify(persist));
        return true;
    } catch (e) {
        console.error('saveState failed', e);
        showToast('⚠️ Could not save progress — storage full');
        return false;
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    loadState();
    updateUI();
    generateCalendar();
    await hydratePhotos();
});

// Switch between tabs
function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(`${tabName}-tab`).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update content if needed
    if (tabName === 'calendar') {
        generateCalendar();
    } else if (tabName === 'progress') {
        loadPhotos();
        updateComparison();
    } else if (tabName === 'settings') {
        renderHabitManager();
    }
}

// Toggle task completion
function toggleTask(taskName) {
    const habit = appState.habits.find(h => h.id === taskName);
    if (habit && habit.type === 'photo') {
        takePhoto();
        return;
    }

    appState.tasks[taskName] = !appState.tasks[taskName];
    updateTaskUI(taskName);
    updateProgressRing();
    saveState();
}

// Update task UI
function updateTaskUI(taskName) {
    const taskCard = document.querySelector(`.task-card[data-task="${taskName}"]`);
    if (!taskCard) return;
    if (appState.tasks[taskName]) {
        taskCard.classList.add('completed');
    } else {
        taskCard.classList.remove('completed');
    }
}

// Escape user-provided text before inserting into HTML.
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Render today's task cards from the habits list.
function renderTasks() {
    const container = document.getElementById('tasksContainer');
    if (!container) return;

    if (!appState.habits.length) {
        container.innerHTML = `
            <div class="empty-habits">
                <p>No habits yet. Add some in <strong>Settings → Habits</strong>.</p>
            </div>`;
        return;
    }

    container.innerHTML = appState.habits.map(habit => {
        const done = appState.tasks[habit.id] ? ' completed' : '';
        const isPhoto = habit.type === 'photo';
        const extraClass = isPhoto ? ' photo-task' : '';
        const photoImg = isPhoto && appState.photos[appState.currentDay]
            ? `<img src="${appState.photos[appState.currentDay]}" alt="Progress photo">` : '';
        const preview = isPhoto ? `<div class="photo-preview" id="photoPreview">${photoImg}</div>` : '';
        return `
            <div class="task-card${extraClass}${done}" data-task="${escapeHtml(habit.id)}" onclick="toggleTask('${escapeHtml(habit.id)}')">
                <div class="task-checkbox">
                    <div class="checkmark"></div>
                </div>
                <div class="task-info">
                    <h3 class="task-title">${escapeHtml(habit.title)}</h3>
                    <p class="task-description">${escapeHtml(habit.description)}</p>
                </div>
                ${preview}
            </div>`;
    }).join('');
}

// Update progress ring
function updateProgressRing() {
    const totalTasks = appState.habits.length;
    const completedTasks = appState.habits.filter(h => appState.tasks[h.id]).length;
    const percentage = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const circle = document.getElementById('progressCircle');
    const circumference = 2 * Math.PI * 52;
    const offset = circumference - (percentage / 100) * circumference;
    
    circle.style.strokeDashoffset = offset;
    document.getElementById('completionPercentage').textContent = percentage;
}

// Take photo
function takePhoto() {
    document.getElementById('photoInput').click();
}

// Handle photo capture
async function handlePhotoCapture(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = ''; // allow re-selecting the same file later

    let imageData;
    try {
        imageData = await downscaleImage(file);
    } catch (e) {
        console.error('Could not process photo', e);
        showToast('⚠️ Could not process photo');
        return;
    }

    // Cache in memory and persist to IndexedDB (not localStorage).
    appState.photos[appState.currentDay] = imageData;
    try {
        await photoSet(appState.currentDay, imageData);
    } catch (e) {
        console.error('Could not save photo', e);
        showToast('⚠️ Could not save photo — but your day still counts');
    }

    // The photo habit (whatever its id) is now satisfied.
    const photoHabit = appState.habits.find(h => h.type === 'photo');
    if (photoHabit) appState.tasks[photoHabit.id] = true;

    refreshPhotoUI();
    updateProgressRing();
    saveState();
    showToast('Photo saved! 📸');
}

// Refresh anything that displays photos (today's preview + galleries).
function refreshPhotoUI() {
    const photoHabit = appState.habits.find(h => h.type === 'photo');
    const preview = document.getElementById('photoPreview');
    if (preview) {
        const img = appState.photos[appState.currentDay];
        preview.innerHTML = img ? `<img src="${img}" alt="Progress photo">` : '';
    }
    if (photoHabit) updateTaskUI(photoHabit.id);
    loadPhotos();
    if (document.getElementById('progress-tab')?.classList.contains('active')) {
        updateComparison();
    }
}

// End current day
function endDay() {
    const allTasksComplete = appState.habits.length > 0 &&
        appState.habits.every(h => appState.tasks[h.id]);

    if (!allTasksComplete) {
        showModal(
            'Incomplete Day',
            'You haven\'t completed all tasks. If you end the day now, you\'ll have to start over from Day 1. Are you sure?',
            [
                { text: 'Cancel', class: 'secondary', action: () => hideModal() },
                { text: 'Start Over', class: 'primary', action: () => restartChallenge() }
            ]
        );
        return;
    }

    // CRITICAL: Save current day progress BEFORE incrementing
    appState.dailyProgress[appState.currentDay] = {
        date: new Date().toISOString(),
        completed: true,
        tasks: { ...appState.tasks }
    };
    
    // Save immediately to prevent data loss
    saveState();

    // Move to next day
    if (appState.currentDay < 75) {
        const completedDay = appState.currentDay;
        appState.currentDay++;
        resetDailyTasks();
        
        // Save again after moving to next day
        saveState();
        updateUI();
        
        showToast(`Day ${completedDay} complete! 🎉`);
    } else {
        // Challenge completed!
        saveState();
        completeChallengeSuccess();
    }
}

// Reset daily tasks
function resetDailyTasks() {
    appState.tasks = buildTasks(appState.habits);
}

// Complete challenge success
function completeChallengeSuccess() {
    showModal(
        '🎉 Challenge Complete! 🎉',
        'Congratulations! You\'ve completed the 75 Hard Challenge! You\'ve proven your mental toughness and transformed your life. This is just the beginning!',
        [
            { text: 'Start New Challenge', class: 'primary', action: () => { hideModal(); resetChallenge(); } }
        ]
    );
}

// Restart challenge (failed day)
function restartChallenge() {
    // Save to attempt history
    appState.attempts.push({
        startDate: appState.startDate,
        endDate: new Date().toISOString(),
        daysCompleted: appState.currentDay - 1,
        reason: 'incomplete'
    });

    // Reset to day 1
    appState.currentDay = 1;
    appState.startDate = new Date().toISOString();
    appState.dailyProgress = {};
    resetDailyTasks();
    
    updateUI();
    saveState();
    hideModal();
    showToast('Starting fresh from Day 1 💪');
}

// Reset challenge (from settings)
function resetChallenge() {
    if (appState.currentDay > 1) {
        showModal(
            'Start New Challenge?',
            'This will save your current attempt and start a new challenge from Day 1. Are you sure?',
            [
                { text: 'Cancel', class: 'secondary', action: () => hideModal() },
                { text: 'Start New', class: 'primary', action: () => confirmResetChallenge() }
            ]
        );
    } else {
        confirmResetChallenge();
    }
}

// Fix stuck day - manually advance to next day
function fixStuckDay() {
    showModal(
        'Fix Stuck Day?',
        `This will move you from Day ${appState.currentDay} to Day ${appState.currentDay + 1} and reset today's tasks. Use this if you're stuck in a loop. Are you sure?`,
        [
            { text: 'Cancel', class: 'secondary', action: () => hideModal() },
            { text: 'Fix It', class: 'primary', action: () => confirmFixStuckDay() }
        ]
    );
}

function confirmFixStuckDay() {
    if (appState.currentDay < 75) {
        appState.currentDay++;
        resetDailyTasks();
        saveState();
        updateUI();
        hideModal();
        showToast(`Moved to Day ${appState.currentDay} ✅`);
    } else {
        hideModal();
        showToast('Already on Day 75!');
    }
}

function confirmResetChallenge() {
    if (appState.currentDay > 1) {
        appState.attempts.push({
            startDate: appState.startDate,
            endDate: new Date().toISOString(),
            daysCompleted: appState.currentDay - 1,
            reason: 'reset'
        });
    }

    appState.currentDay = 1;
    appState.startDate = new Date().toISOString();
    appState.dailyProgress = {};
    appState.photos = {};
    resetDailyTasks();
    
    updateUI();
    saveState();
    hideModal();
    showToast('New challenge started! 🚀');
}

// Clear all data
function clearAllData() {
    showModal(
        '⚠️ Clear All Data?',
        'This will permanently delete all your progress, photos, and history. This action cannot be undone!',
        [
            { text: 'Cancel', class: 'secondary', action: () => hideModal() },
            { text: 'Delete Everything', class: 'primary', action: () => confirmClearData() }
        ]
    );
}

function confirmClearData() {
    localStorage.removeItem('75hard-state');
    photoClearAll().catch(err => console.error('Could not clear photos', err));
    const habits = defaultHabits();
    appState = {
        currentDay: 1,
        startDate: null,
        habits: habits,
        tasks: buildTasks(habits),
        dailyProgress: {},
        photos: {},
        attempts: []
    };
    updateUI();
    refreshPhotoUI();
    hideModal();
    showToast('All data cleared');
}

// Update UI
function updateUI() {
    // Update day counter
    document.getElementById('currentDay').textContent = appState.currentDay;
    document.getElementById('endDayNumber').textContent = appState.currentDay;
    
    // Update start date display
    const startDateDisplay = document.getElementById('startDateDisplay');
    if (appState.startDate) {
        const date = new Date(appState.startDate);
        startDateDisplay.textContent = date.toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
        });
    } else {
        startDateDisplay.textContent = 'Not started';
    }
    
    // Update current day display in settings
    const currentDayDisplay = document.getElementById('currentDayDisplay');
    if (currentDayDisplay) {
        currentDayDisplay.textContent = `Day ${appState.currentDay} of 75`;
    }

    // If no start date, set it now
    if (!appState.startDate && appState.currentDay === 1) {
        appState.startDate = new Date().toISOString();
        saveState();
    }

    // Render today's task cards from the habits list (data-driven)
    renderTasks();

    // Update progress ring
    updateProgressRing();
    
    // Update calendar stats
    updateCalendarStats();
}

// Generate calendar
function generateCalendar() {
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    for (let day = 1; day <= 75; day++) {
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        dayElement.textContent = day;

        if (day === appState.currentDay) {
            dayElement.classList.add('current');
        } else if (appState.dailyProgress[day]?.completed) {
            dayElement.classList.add('completed');
        } else if (day < appState.currentDay) {
            dayElement.classList.add('incomplete');
        }

        grid.appendChild(dayElement);
    }

    // Update attempt history
    updateAttemptHistory();
}

// Update calendar stats
function updateCalendarStats() {
    const completedDays = Object.values(appState.dailyProgress).filter(d => d.completed).length;
    const remainingDays = 75 - appState.currentDay + 1;
    const streak = appState.currentDay - 1;

    document.getElementById('completedDays').textContent = completedDays;
    document.getElementById('currentStreak').textContent = streak;
    document.getElementById('remainingDays').textContent = remainingDays;
}

// Update attempt history
function updateAttemptHistory() {
    const historyContainer = document.getElementById('attemptHistory');
    
    if (appState.attempts.length === 0) {
        historyContainer.innerHTML = '<p class="no-attempts">No previous attempts yet. You got this! 💪</p>';
        return;
    }

    historyContainer.innerHTML = appState.attempts.reverse().map((attempt, index) => {
        const startDate = new Date(attempt.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const endDate = new Date(attempt.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        
        return `
            <div class="attempt-item">
                <h4>Attempt ${appState.attempts.length - index}</h4>
                <p>Started: ${startDate}</p>
                <p>Ended: ${endDate}</p>
                <p>Days completed: ${attempt.daysCompleted} / 75</p>
            </div>
        `;
    }).join('');
}

// Load photos for gallery
function loadPhotos() {
    const gallery = document.getElementById('photoGallery');
    const photoKeys = Object.keys(appState.photos).sort((a, b) => b - a);

    if (photoKeys.length === 0) {
        gallery.innerHTML = '';
        return;
    }

    gallery.innerHTML = photoKeys.map(day => `
        <div class="gallery-item" onclick="viewPhoto(${day})">
            <img src="${appState.photos[day]}" alt="Day ${day}">
            <div class="gallery-day">Day ${day}</div>
        </div>
    `).join('');
}

// Update comparison slider
function updateComparison() {
    const container = document.getElementById('photoComparisonContainer');
    const photoKeys = Object.keys(appState.photos).sort((a, b) => parseInt(a) - parseInt(b));

    if (photoKeys.length < 2) {
        container.innerHTML = `
            <div class="no-photos-message">
                <span class="emoji">📸</span>
                <p>Take more progress photos to see your transformation!</p>
            </div>
        `;
        return;
    }

    const firstPhoto = appState.photos[photoKeys[0]];
    const latestPhoto = appState.photos[photoKeys[photoKeys.length - 1]];
    const firstDay = photoKeys[0];
    const latestDay = photoKeys[photoKeys.length - 1];

    container.innerHTML = `
        <div class="comparison-slider" id="comparisonSlider">
            <img class="comparison-image" src="${latestPhoto}" alt="After">
            <div class="comparison-overlay" id="comparisonOverlay">
                <img class="comparison-image" src="${firstPhoto}" alt="Before">
            </div>
            <div class="comparison-slider-handle" id="sliderHandle">
                <div class="comparison-slider-button">⟷</div>
            </div>
            <div class="comparison-label before">Day ${firstDay}</div>
            <div class="comparison-label after">Day ${latestDay}</div>
        </div>
    `;

    initComparisonSlider();
}

// Initialize comparison slider
function initComparisonSlider() {
    const slider = document.getElementById('comparisonSlider');
    if (!slider) return;

    const handle = document.getElementById('sliderHandle');
    const overlay = document.getElementById('comparisonOverlay');
    let isDragging = false;

    function updateSlider(x) {
        const rect = slider.getBoundingClientRect();
        const position = Math.max(0, Math.min(x - rect.left, rect.width));
        const percentage = (position / rect.width) * 100;

        handle.style.left = percentage + '%';
        overlay.style.width = percentage + '%';
    }

    handle.addEventListener('mousedown', () => isDragging = true);
    handle.addEventListener('touchstart', () => isDragging = true);

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        updateSlider(e.clientX);
    });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        updateSlider(e.touches[0].clientX);
    });

    document.addEventListener('mouseup', () => isDragging = false);
    document.addEventListener('touchend', () => isDragging = false);

    slider.addEventListener('click', (e) => {
        updateSlider(e.clientX);
    });
}

// View photo (could expand to full screen)
function viewPhoto(day) {
    // For now, just log it
    console.log('Viewing photo for day', day);
}

/* ------------------------------------------------------------------ */
/* Habit management — add / edit / delete / reorder custom habits      */
/* ------------------------------------------------------------------ */

function genHabitId() {
    let id;
    do {
        id = 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    } while (appState.habits.some(h => h.id === id));
    return id;
}

// Render the editable habit list in Settings.
function renderHabitManager() {
    const container = document.getElementById('habitManager');
    if (!container) return;

    if (!appState.habits.length) {
        container.innerHTML = '<p class="habit-empty">No habits yet — add one below.</p>';
        return;
    }

    container.innerHTML = appState.habits.map(h => `
        <div class="habit-row" data-id="${escapeHtml(h.id)}">
            <div class="habit-drag" title="Drag to reorder">⠿</div>
            <div class="habit-row-info">
                <div class="habit-row-title">${escapeHtml(h.title)}${h.type === 'photo' ? ' 📸' : ''}</div>
                <div class="habit-row-desc">${escapeHtml(h.description || '')}</div>
            </div>
            <button class="habit-icon-btn" data-edit="${escapeHtml(h.id)}" aria-label="Edit">✎</button>
            <button class="habit-icon-btn danger" data-del="${escapeHtml(h.id)}" aria-label="Delete">✕</button>
        </div>`).join('');

    container.querySelectorAll('.habit-drag').forEach(handle => {
        handle.addEventListener('pointerdown', (e) => {
            const row = handle.closest('.habit-row');
            if (row) startHabitDrag(e, row.dataset.id);
        });
    });
    container.querySelectorAll('[data-edit]').forEach(b =>
        b.addEventListener('click', () => openHabitForm(b.dataset.edit)));
    container.querySelectorAll('[data-del]').forEach(b =>
        b.addEventListener('click', () => deleteHabit(b.dataset.del)));
}

// --- Drag-and-drop reordering (pointer events: works on touch + mouse) ---
let _habitDrag = null;

function startHabitDrag(e, id) {
    e.preventDefault();
    const container = document.getElementById('habitManager');
    const row = container && container.querySelector(`.habit-row[data-id="${id}"]`);
    if (!row) return;
    _habitDrag = { row, container };
    row.classList.add('dragging');
    document.body.classList.add('habit-dragging');
    document.addEventListener('pointermove', onHabitDragMove);
    document.addEventListener('pointerup', endHabitDrag);
    document.addEventListener('pointercancel', endHabitDrag);
}

function onHabitDragMove(e) {
    if (!_habitDrag) return;
    e.preventDefault();
    const { container, row } = _habitDrag;
    const others = [...container.querySelectorAll('.habit-row:not(.dragging)')];
    let ref = null;
    for (const r of others) {
        const rect = r.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { ref = r; break; }
    }
    if (ref) container.insertBefore(row, ref);
    else container.appendChild(row);
}

function endHabitDrag() {
    if (!_habitDrag) return;
    const { container, row } = _habitDrag;
    row.classList.remove('dragging');
    document.body.classList.remove('habit-dragging');
    document.removeEventListener('pointermove', onHabitDragMove);
    document.removeEventListener('pointerup', endHabitDrag);
    document.removeEventListener('pointercancel', endHabitDrag);
    _habitDrag = null;

    // Commit the new order from the DOM back into state.
    const order = [...container.querySelectorAll('.habit-row')].map(r => r.dataset.id);
    appState.habits.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    saveState();
    updateUI(); // reflect the new order on the Today tab
}

// --- Add / edit form ---
function openHabitForm(id) {
    const editing = id ? appState.habits.find(h => h.id === id) : null;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'habitFormModal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>${editing ? 'Edit Habit' : 'Add Habit'}</h3>
            <input id="habitTitleInput" class="habit-input" type="text" maxlength="60"
                   placeholder="Habit name" value="${editing ? escapeHtml(editing.title) : ''}">
            <textarea id="habitDescInput" class="habit-input" maxlength="120" rows="2"
                      placeholder="Short description (optional)">${editing ? escapeHtml(editing.description || '') : ''}</textarea>
            <div class="modal-buttons">
                <button class="modal-button secondary" onclick="hideHabitForm()">Cancel</button>
                <button class="modal-button primary" id="habitFormSave">Save</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('habitFormSave').addEventListener('click', () => saveHabitForm(id || null));
    document.getElementById('habitTitleInput').focus();
}

function hideHabitForm() {
    const m = document.getElementById('habitFormModal');
    if (m) m.remove();
}

function saveHabitForm(id) {
    const title = document.getElementById('habitTitleInput').value.trim();
    const description = document.getElementById('habitDescInput').value.trim();
    if (!title) { showToast('Please enter a habit name'); return; }

    if (id) {
        const h = appState.habits.find(x => x.id === id);
        if (h) { h.title = title; h.description = description; }
    } else {
        const newId = genHabitId();
        appState.habits.push({ id: newId, title, description, type: 'check' });
        appState.tasks[newId] = false;
    }
    saveState();
    hideHabitForm();
    renderHabitManager();
    updateUI();
    showToast(id ? 'Habit updated' : 'Habit added');
}

// --- Delete ---
let _pendingDeleteHabitId = null;
function deleteHabit(id) {
    const h = appState.habits.find(x => x.id === id);
    if (!h) return;
    _pendingDeleteHabitId = id;
    showModal(
        'Delete Habit?',
        `Remove "${escapeHtml(h.title)}" from your daily list?`,
        [
            { text: 'Cancel', class: 'secondary', action: () => hideModal() },
            { text: 'Delete', class: 'primary', action: () => confirmDeleteHabit() }
        ]
    );
}

function confirmDeleteHabit() {
    const id = _pendingDeleteHabitId;
    _pendingDeleteHabitId = null;
    if (id) {
        appState.habits = appState.habits.filter(h => h.id !== id);
        delete appState.tasks[id];
        saveState();
        renderHabitManager();
        updateUI();
        showToast('Habit removed');
    }
    hideModal();
}

// --- Reset to the canonical 75 Hard list ---
function resetHabitsToDefaults() {
    showModal(
        'Reset Habits?',
        'Restore the original 75 Hard habits? Your custom habits will be removed. Day progress is kept.',
        [
            { text: 'Cancel', class: 'secondary', action: () => hideModal() },
            { text: 'Reset', class: 'primary', action: () => confirmResetHabits() }
        ]
    );
}

function confirmResetHabits() {
    appState.habits = defaultHabits();
    const newTasks = buildTasks(appState.habits);
    // Preserve today's completion for habits that still exist.
    appState.habits.forEach(h => { if (appState.tasks[h.id]) newTasks[h.id] = true; });
    appState.tasks = newTasks;
    saveState();
    renderHabitManager();
    updateUI();
    hideModal();
    showToast('Habits reset to defaults');
}

// Modal functions
function showModal(title, message, buttons) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'appModal';

    const buttonHTML = buttons.map(btn => 
        `<button class="modal-button ${btn.class}" onclick="(${btn.action.toString()})()">${btn.text}</button>`
    ).join('');

    modal.innerHTML = `
        <div class="modal-content">
            <h3>${title}</h3>
            <p>${message}</p>
            <div class="modal-buttons">
                ${buttonHTML}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function hideModal() {
    const modal = document.getElementById('appModal');
    if (modal) {
        modal.remove();
    }
}

// Toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        z-index: 3000;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        animation: toastIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Add toast animations to the page
const style = document.createElement('style');
style.textContent = `
    @keyframes toastIn {
        from {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    }
    @keyframes toastOut {
        from {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        to {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
        }
    }
`;
document.head.appendChild(style);
