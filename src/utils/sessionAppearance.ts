import type { Session, SessionEnvironment } from '../types/entities';

interface EnvironmentAppearance {
  accent: string;
  badge: string;
  glyph: string;
  label: string;
}

const ENVIRONMENT_APPEARANCE: Record<SessionEnvironment, EnvironmentAppearance> = {
  development: {
    accent: '#2563eb',
    badge: 'DEV',
    glyph: '</>',
    label: 'Development'
  },
  staging: {
    accent: '#d97706',
    badge: 'STG',
    glyph: '~',
    label: 'Staging'
  },
  production: {
    accent: '#dc2626',
    badge: 'PRD',
    glyph: '!',
    label: 'Production'
  }
};

function normalizeHexColor(value: string) {
  const candidate = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(candidate)) {
    return candidate;
  }

  if (/^#[0-9a-f]{3}$/i.test(candidate)) {
    const [r, g, b] = candidate.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return null;
}

export function getEnvironmentAppearance(environment: SessionEnvironment) {
  return ENVIRONMENT_APPEARANCE[environment];
}

export function getSessionAccent(session: Pick<Session, 'environment' | 'color'>) {
  return normalizeHexColor(session.color) ?? getEnvironmentAppearance(session.environment).accent;
}

export function withAlpha(color: string, alpha: number) {
  const hex = normalizeHexColor(color);

  if (!hex) {
    return color;
  }

  const numeric = Number.parseInt(hex.slice(1), 16);
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
