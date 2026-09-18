import type { ScanSettings } from '../types/scanner';

interface Props {
  settings: ScanSettings;
  onSettings: (settings: ScanSettings) => void;
  onClose: () => void;
}

/** Everything used rarely enough that it does not belong on the main toolbar. */
export function OptionsModal({ settings, onSettings, onClose }: Props) {
  return (
    <div className="scanner-modal-overlay" onClick={onClose}>
      <div className="scanner-modal" onClick={(e) => e.stopPropagation()}>
        <header className="scanner-modal-head">
          <h2>Options</h2>
          <button type="button" className="scanner-modal-close" onClick={onClose} title="Close">✕</button>
        </header>
        <div className="scanner-modal-body">
          <label className="modal-field" title="Goes at the front of the exported XLSX filename, e.g. MM9.17.13L1342.xlsx">
            Your initials
            <input type="text" maxLength={4} placeholder="e.g. MM" value={settings.exporterInitials} onChange={(e) => onSettings({ ...settings, exporterInitials: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) })} />
          </label>
          <label className="modal-field">Scan mode
            <select value={settings.mode} onChange={(e) => onSettings({ ...settings, mode: e.target.value as 'regular' | 'ocr' })}>
              <option value="regular">Regular</option>
              <option value="ocr">OCR</option>
            </select>
          </label>
          <label className="modal-field">Regular pages
            <input type="number" min="1" max="9999" value={settings.regularPages} onChange={(e) => onSettings({ ...settings, regularPages: Math.max(1, Number(e.target.value) || 9999) })} />
          </label>
          <label className="modal-field">OCR pages
            <input type="number" min="1" max="9999" value={settings.ocrPages} onChange={(e) => onSettings({ ...settings, ocrPages: Math.max(1, Number(e.target.value) || 9999) })} />
          </label>
          <label className="modal-field" title="The application is always scanned first. If its stated revenue is under this amount, that company's statements are skipped. 0 turns this off.">
            Revenue exclusion threshold
            <input type="number" min="0" step="1000" value={settings.revenueExclusionThreshold} onChange={(e) => onSettings({ ...settings, revenueExclusionThreshold: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="modal-field">Duplicate files
            <select value={settings.duplicateHandling} onChange={(e) => onSettings({ ...settings, duplicateHandling: e.target.value as 'flag' | 'skip' })}>
              <option value="flag">Flag, keep in audit trail</option>
              <option value="skip">Skip on upload</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
