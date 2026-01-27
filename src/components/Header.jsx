import React, { useRef, useState, useEffect } from 'react';
import Calendar from './Calendar'; // Import Calendar

export default function Header({
    t,
    alertCounts,
    date,
    languages,
    currentLang,
    onSetLang,
    onDateChange,
    availableDates = [],
    viewMode,
    onViewModeChange
}) {
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const dateRef = useRef(null);

    // Helpers for date manipulation
    const handlePrevDay = () => {
        if (!date) return;

        // Try to skip to previous available date
        if (availableDates && availableDates.length > 0) {
            const currentIndex = availableDates.indexOf(date);
            if (currentIndex !== -1 && currentIndex < availableDates.length - 1) {
                onDateChange(availableDates[currentIndex + 1]);
                return;
            }
        }

        const d = new Date(date);
        d.setDate(d.getDate() - 1);
        onDateChange(d.toISOString().split('T')[0]);
    };

    const handleNextDay = () => {
        if (!date) return;

        // Try to skip to next available date
        if (availableDates && availableDates.length > 0) {
            const currentIndex = availableDates.indexOf(date);
            if (currentIndex !== -1 && currentIndex > 0) {
                onDateChange(availableDates[currentIndex - 1]);
                return;
            }
        }

        const d = new Date(date);
        d.setDate(d.getDate() + 1);
        const nextDate = d.toISOString().split('T')[0];
        onDateChange(nextDate);
    };

    // Close calendar when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dateRef.current && !dateRef.current.contains(event.target)) {
                setIsCalendarOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    return (
        <header className="app-header">
            <div className="header-title">
                <h1>{t.title}</h1>
                <span className="header-subtitle">{t.subtitle}</span>
            </div>

            <div className="header-meta">
                <div className="alert-counts">
                    <span className="alert-count alert-count--red">{alertCounts.red} {t.red}</span>
                    <span className="alert-count alert-count--orange">{alertCounts.orange} {t.orange}</span>
                    <span className="alert-count alert-count--yellow">{alertCounts.yellow} {t.yellow}</span>
                </div>

                <div className="date-navigator">
                    <button className="nav-arrow" onClick={handlePrevDay} aria-label="Previous Day">&lt;</button>

                    <div className="date-display-wrapper" ref={dateRef}>
                        <div
                            className="date-display"
                            onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                            title="Select Date"
                        >
                            <span className="date-text">{date || 'Loading...'}</span>
                        </div>
                        {isCalendarOpen && (
                            <Calendar
                                date={date}
                                availableDates={availableDates}
                                onSelect={onDateChange}
                                onClose={() => setIsCalendarOpen(false)}
                                t={t}
                            />
                        )}
                    </div>

                    <button className="nav-arrow" onClick={handleNextDay} aria-label="Next Day">&gt;</button>
                    <button
                        className="today-btn"
                        onClick={() => availableDates.length > 0 && onDateChange(availableDates[0])}
                        title="Go to Latest"
                    >
                        Today
                    </button>
                </div>

                <div className="lang-selector">
                    {languages.map(l => (
                        <button
                            key={l.code}
                            className={`lang-btn ${currentLang === l.code ? 'lang-btn--active' : ''}`}
                            onClick={() => onSetLang(l.code)}
                        >
                            {l.label}
                        </button>
                    ))}
                </div>

                <div className="view-mode-selector">
                    <span className="view-mode-label">{t.viewMode.title}:</span>
                    <div className="view-mode-btns">
                        <button
                            className={`view-mode-btn ${viewMode === 'surge_r' ? 'view-mode-btn--active' : ''}`}
                            onClick={() => onViewModeChange('surge_r')}
                        >
                            {t.viewMode.surge_r}
                        </button>
                        <button
                            className={`view-mode-btn ${viewMode === 'raw' ? 'view-mode-btn--active' : ''}`}
                            onClick={() => onViewModeChange('raw')}
                        >
                            {t.viewMode.raw}
                        </button>
                        <button
                            className={`view-mode-btn ${viewMode === 'surge' ? 'view-mode-btn--active' : ''}`}
                            onClick={() => onViewModeChange('surge')}
                        >
                            {t.viewMode.surge}
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}
