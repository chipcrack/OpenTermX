export type SessionEnvironment = 'production' | 'staging' | 'development';
export type SessionAuthKind = 'manual' | 'credential';
export type ThemeMode = 'dark' | 'light';

export interface Session {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  environment: SessionEnvironment;
  groupName: string;
  color: string;
  description: string;
  lastConnection: string;
  favorite: boolean;
  authKind: SessionAuthKind;
  credentialId: string | null;
  credentialLabel: string | null;
  hasPassword: boolean;
}

export interface SessionDraft {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  environment: SessionEnvironment;
  groupName: string;
  color: string;
  description: string;
  favorite: boolean;
  authKind: SessionAuthKind;
  credentialId: string | null;
  password?: string;
}

export interface Credential {
  id: string;
  label: string;
  username: string;
  password: string;
  note: string;
}

export interface CredentialDraft {
  id?: string;
  label: string;
  username: string;
  password: string;
  note: string;
}

export interface Tunnel {
  id: string;
  sessionId: string;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: 'active' | 'inactive';
}

export interface TunnelDraft {
  id?: string;
  sessionId: string;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: 'active' | 'inactive';
}

export interface TerminalTab {
  id: string;
  sessionId: string;
  title: string;
  connected: boolean;
}

export interface SftpEntry {
  id: string;
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: string;
  modifiedAt: string;
}

export interface TerminalBootstrap {
  shellId: string;
  banner: string;
  connected: boolean;
  initialOutput?: string;
}

export interface TerminalOutput {
  data: string;
  closed: boolean;
}
