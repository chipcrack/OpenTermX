import type { Credential, Session, SftpEntry, Tunnel } from '../types/entities';

export const mockCredentials: Credential[] = [
  {
    id: 'cred-deploy',
    label: 'Deploy Production',
    username: 'deploy',
    password: 'secret-demo-password',
    note: 'Credencial de ejemplo para producción'
  },
  {
    id: 'cred-frontend',
    label: 'Frontend Staging',
    username: 'frontend',
    password: 'secret-demo-password',
    note: 'Credencial de ejemplo para staging'
  }
];

export const mockSessions: Session[] = [
  {
    id: 'prod-api',
    name: 'Production API',
    host: 'api.prod.internal',
    port: 22,
    username: 'deploy',
    environment: 'production',
    groupName: 'Core Platform',
    color: '#ef4444',
    description: 'Servicios críticos del API principal',
    lastConnection: 'Hace 18 min',
    favorite: true,
    authKind: 'credential',
    credentialId: 'cred-deploy',
    credentialLabel: 'Deploy Production',
    hasPassword: false
  },
  {
    id: 'staging-web',
    name: 'Staging Web',
    host: 'web.staging.internal',
    port: 22,
    username: 'frontend',
    environment: 'staging',
    groupName: 'Web Experience',
    color: '#f59e0b',
    description: 'Entorno de validación para QA',
    lastConnection: 'Hace 2 h',
    favorite: false,
    authKind: 'credential',
    credentialId: 'cred-frontend',
    credentialLabel: 'Frontend Staging',
    hasPassword: false
  },
  {
    id: 'dev-db',
    name: 'Dev Database',
    host: 'db.dev.internal',
    port: 22,
    username: 'postgres',
    environment: 'development',
    groupName: 'Data Services',
    color: '#22c55e',
    description: 'Base de datos de desarrollo local remota',
    lastConnection: 'Ayer',
    favorite: false,
    authKind: 'manual',
    credentialId: null,
    credentialLabel: null,
    hasPassword: true
  }
];

export const mockTunnels: Tunnel[] = [
  {
    id: 'tunnel-admin',
    sessionId: 'prod-api',
    name: 'Admin Dashboard',
    localPort: 8080,
    remoteHost: '127.0.0.1',
    remotePort: 3000,
    status: 'active'
  },
  {
    id: 'tunnel-pg',
    sessionId: 'dev-db',
    name: 'PostgreSQL Forward',
    localPort: 5433,
    remoteHost: '127.0.0.1',
    remotePort: 5432,
    status: 'inactive'
  }
];

export const mockSftpEntries: Record<string, SftpEntry[]> = {
  'prod-api': [
    {
      id: 'deploy',
      name: 'deploy',
      path: '/srv/deploy',
      type: 'directory',
      size: '—',
      modifiedAt: '2026-06-02 09:15'
    },
    {
      id: 'logs',
      name: 'logs',
      path: '/srv/logs',
      type: 'directory',
      size: '—',
      modifiedAt: '2026-06-02 09:11'
    },
    {
      id: 'env',
      name: '.env.production',
      path: '/srv/.env.production',
      type: 'file',
      size: '4 KB',
      modifiedAt: '2026-06-01 18:42'
    }
  ],
  'staging-web': [
    {
      id: 'build',
      name: 'build',
      path: '/var/www/build',
      type: 'directory',
      size: '—',
      modifiedAt: '2026-06-01 22:10'
    },
    {
      id: 'nginx',
      name: 'nginx.conf',
      path: '/etc/nginx/nginx.conf',
      type: 'file',
      size: '12 KB',
      modifiedAt: '2026-05-30 14:04'
    }
  ],
  'dev-db': [
    {
      id: 'backup',
      name: 'backup.sql.gz',
      path: '/var/backups/backup.sql.gz',
      type: 'file',
      size: '82 MB',
      modifiedAt: '2026-06-02 03:12'
    },
    {
      id: 'scripts',
      name: 'scripts',
      path: '/opt/scripts',
      type: 'directory',
      size: '—',
      modifiedAt: '2026-05-29 08:21'
    }
  ]
};
