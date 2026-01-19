// Initialize app state
let appState = {
    currentDay: 1,
    startDate: null,
    tasks: {
        diet: false,
        workout1: false,
        workout2: false,
        water: false,
        reading: false,
        squats: false,
        pushups: false,
        abholds: false,
        photo: false
    },
    dailyProgress: {},
    photos: {},
    attempts: []
};

// Load saved state from localStorage
function loadState() {
    const saved = localStorage.getItem('75hard-state');
    if (saved) {
        appState = JSON.parse(saved);
        updateUI();
    }
}

// Save state to localStorage
function saveState() {
    localStorage.setItem('75hard-state', JSON.stringify(appState));
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    updateUI();
    generateCalendar();
    loadPhotos();
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
    }
}

// Toggle task completion
function toggleTask(taskName) {
    if (taskName === 'photo') {
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
    const taskCard = document.querySelector(`[data-task="${taskName}"]`);
    if (appState.tasks[taskName]) {
        taskCard.classList.add('completed');
    } else {
        taskCard.classList.remove('completed');
    }
}

// Update progress ring
function updateProgressRing() {
    const totalTasks = 9;
    const completedTasks = Object.values(appState.tasks).filter(Boolean).length;
    const percentage = Math.round((completedTasks / totalTasks) * 100);
    
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
function handlePhotoCapture(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const imageData = e.target.result;
        
        // Save photo for current day
        appState.photos[appState.currentDay] = imageData;
        appState.tasks.photo = true;
        
        // Update preview
        const preview = document.getElementById('photoPreview');
        preview.innerHTML = `<img src="${imageData}" alt="Progress photo">`;
        
        // Update task UI
        updateTaskUI('photo');
        updateProgressRing();
        saveState();
        
        // Show success feedback
        showToast('Photo saved! 📸');
    };
    reader.readAsDataURL(file);
}

// End current day
function endDay() {
    const allTasksComplete = Object.values(appState.tasks).every(Boolean);
    
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

    // Save current day progress
    appState.dailyProgress[appState.currentDay] = {
        date: new Date().toISOString(),
        completed: true,
        tasks: { ...appState.tasks }
    };

    // Move to next day
    if (appState.currentDay < 75) {
        appState.currentDay++;
        resetDailyTasks();
        updateUI();
        saveState();
        showToast(`Day ${appState.currentDay - 1} complete! 🎉`);
    } else {
        // Challenge completed!
        completeChallengeSuccess();
    }
}

// Reset daily tasks
function resetDailyTasks() {
    appState.tasks = {
        diet: false,
        workout1: false,
        workout2: false,
        water: false,
        reading: false,
        squats: false,
        pushups: false,
        abholds: false,
        photo: false
    };
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
    appState = {
        currentDay: 1,
        startDate: null,
        tasks: {
            diet: false,
            workout1: false,
            workout2: false,
            water: false,
            reading: false,
            squats: false,
            pushups: false,
            abholds: false,
            photo: false
        },
        dailyProgress: {},
        photos: {},
        attempts: []
    };
    updateUI();
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

    // If no start date, set it now
    if (!appState.startDate && appState.currentDay === 1) {
        appState.startDate = new Date().toISOString();
        saveState();
    }

    // Update all task UIs
    Object.keys(appState.tasks).forEach(taskName => {
        updateTaskUI(taskName);
    });

    // Update photo preview
    if (appState.photos[appState.currentDay]) {
        const preview = document.getElementById('photoPreview');
        preview.innerHTML = `<img src="${appState.photos[appState.currentDay]}" alt="Progress photo">`;
    } else {
        const preview = document.getElementById('photoPreview');
        preview.innerHTML = '';
    }

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

