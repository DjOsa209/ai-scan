export const BEIJING_OFFSET_MINUTES = 8 * 60;
export const BEIJING_TIME_ZONE = 'Asia/Shanghai';

type DateInput = string | number | Date;

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function beijingParts(value: DateInput) {
  const parts = dateTimeFormatter.formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatBeijingDate(value: DateInput) {
  const parts = beijingParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatBeijingDateTime(value: DateInput) {
  const parts = beijingParts(value);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatBeijingTime(value: DateInput) {
  const parts = beijingParts(value);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}
