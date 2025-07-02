const LoggingService = (() => {
    let sessionLog = [];
    const key = 'sessionLog';

    function init() {
        try {
            const storedLog = sessionStorage.getItem(key);
            if (storedLog) {
                sessionLog = JSON.parse(storedLog);
            } else {
                sessionLog = [];
            }
            logEvent('logging_service_initialized', { from_storage: !!storedLog });
        } catch (e) {
            console.error('Failed to initialize logging service:', e);
            sessionLog = [];
        }
    }

    function logEvent(name, params = {}) {
        const eventData = { 
            timestamp: new Date().toISOString(), 
            level: 'EVENT', 
            name, 
            params 
        };
        sessionLog.push(eventData);
        saveLog();
    }

    function getLog() {
        return sessionLog;
    }
    
    function saveLog() {
        try {
            sessionStorage.setItem(key, JSON.stringify(sessionLog));
        } catch (e) {
            console.error('Failed to save log to session storage:', e);
        }
    }

    // Public API
    return {
        init,
        logEvent,
        getLog
    };
})();

export default LoggingService;