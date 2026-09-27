import type { MarketSession } from '../../types/stocks';
import { NYSE_HOLIDAYS, NYSE_EARLY_CLOSE } from '../../config/stocks';

function getEtComponents(date: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number; dateStr: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const dateStr = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, minute, weekday, dateStr };
}

function formatEtTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function getUsMarketSession(date: Date = new Date()): MarketSession {
  const et = getEtComponents(date);
  const etTime = formatEtTime(et.hour, et.minute);
  const timeMinutes = et.hour * 60 + et.minute;

  if (et.weekday === 0 || et.weekday === 6) {
    return { state: 'closed', label: '美股休市', etTime, reason: 'weekend' };
  }

  const holidays = NYSE_HOLIDAYS[et.year] ?? [];
  if (holidays.includes(et.dateStr)) {
    return { state: 'closed', label: '美股休市', etTime, reason: 'holiday' };
  }

  const earlyCloses = NYSE_EARLY_CLOSE[et.year] ?? [];
  const isEarlyClose = earlyCloses.includes(et.dateStr);
  const closeTime = isEarlyClose ? 13 * 60 : 16 * 60;

  if (timeMinutes < 4 * 60) {
    return { state: 'closed', label: '美股休市', etTime, reason: 'overnight' };
  }
  if (timeMinutes < 9 * 60 + 30) {
    return { state: 'pre', label: '盘前', etTime };
  }
  if (timeMinutes < closeTime) {
    return { state: 'regular', label: '盘中', etTime };
  }
  if (!isEarlyClose && timeMinutes < 20 * 60) {
    return { state: 'post', label: '盘后', etTime };
  }
  if (isEarlyClose && timeMinutes >= closeTime) {
    return { state: 'closed', label: '美股休市', etTime, reason: 'early_close' };
  }

  return { state: 'closed', label: '美股休市', etTime, reason: 'overnight' };
}
