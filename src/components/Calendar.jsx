import React, { useState, useEffect, useRef } from 'react';

export default function Calendar({ date, availableDates, onSelect, onClose, t }) {
    const [viewDate, setViewDate] = useState(new Date(date || new Date()));

    // Ensure viewDate updates if prop date changes substantially (optional, usually internal nav is better)
    // But initializing with 'date' is good.

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth(); // 0-11

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay(); // 0 (Sun) - 6 (Sat)

    const handlePrevMonth = (e) => {
        e.stopPropagation();
        setViewDate(new Date(year, month - 1, 1));
    };

    const handleNextMonth = (e) => {
        e.stopPropagation();
        setViewDate(new Date(year, month + 1, 1));
    };

    const handleDateClick = (day) => {
        const monthStr = String(month + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const isoDate = `${year}-${monthStr}-${dayStr}`;
        onSelect(isoDate);
        onClose();
    };

    // Generate grid
    const days = [];
    // Empty cells for shift
    for (let i = 0; i < firstDay; i++) {
        days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
    }
    // Days
    for (let d = 1; d <= daysInMonth; d++) {
        const monthStr = String(month + 1).padStart(2, '0');
        const dayStr = String(d).padStart(2, '0');
        const isoDate = `${year}-${monthStr}-${dayStr}`;

        const isAvailable = availableDates.includes(isoDate);
        const isSelected = isoDate === date;
        const className = `calendar-day ${isAvailable ? 'available' : 'unavailable'} ${isSelected ? 'selected' : ''}`;

        days.push(
            <div
                key={isoDate}
                className={className}
                onClick={(e) => { e.stopPropagation(); isAvailable ? handleDateClick(d) : null; }} // Allow clicking only available? Or allow any?
            // User said "Skip to date with data" for arrows.
            // For calendar, user said "Mark dates with data".
            // Usually allowing to click any date is better UX (empty map), BUT
            // User's request implies they want to find data.
            // I'll allow clicking ANY date, but style available ones distinctly.
            // Re-read: "Skip to previous data date" was for arrows.
            // "Put a dot on data dates".
            // I will allow navigation to ANY date (to see "No Data" error is fine),
            // but emphasize available ones.
            // Actually, if I allow clicking empty dates, app shows error. 
            // Available ones have distinctive style.
            >
                {d}
                {isAvailable && <span className="data-dot"></span>}
            </div>
        );
    }

    const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    return (
        <div className="calendar-popup" onClick={(e) => e.stopPropagation()}>
            <div className="calendar-header">
                <button className="cal-nav-btn" onClick={handlePrevMonth}>&lt;</button>
                <span className="cal-title">{year} / {String(month + 1).padStart(2, '0')}</span>
                <button className="cal-nav-btn" onClick={handleNextMonth}>&gt;</button>
            </div>
            <div className="calendar-grid">
                {weekDays.map(wd => <div key={wd} className="calendar-weekday">{wd}</div>)}
                {days}
            </div>
        </div>
    );
}
