import { execSync } from 'node:child_process';
import { getLogger } from '../utils/logger.js';

export interface PortProcessInfo {
  pid: number;
  command: string;
  port: number;
}

export class PortDetector {
  detectByPort(port: number): PortProcessInfo | null {
    try {
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        const output = execSync(`netstat -ano | findstr :${port}`, {
          encoding: 'utf-8',
          timeout: 5000,
        });

        const lines = output.split('\n').filter((l) => l.includes('LISTENING'));
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1]!, 10);
          if (!isNaN(pid)) {
            return { pid, command: '', port };
          }
        }
      } else {
        const output = execSync(`lsof -i :${port} -s TCP:LISTEN -P -n 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 5000,
        });

        const lines = output.split('\n').filter((l) => l.includes('LISTEN'));
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            const pid = parseInt(parts[1]!, 10);
            const command = parts[0] ?? '';
            if (!isNaN(pid)) {
              return { pid, command, port };
            }
          }
        }
      }

      return null;
    } catch (error) {
      getLogger().error({ error, port }, 'Port detection failed');
      return null;
    }
  }

  detectByPid(pid: number): PortProcessInfo | null {
    try {
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        const output = execSync(`netstat -ano | findstr ${pid}`, {
          encoding: 'utf-8',
          timeout: 5000,
        });

        const lines = output.split('\n').filter((l) => l.includes('LISTENING'));
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const address = parts[1] ?? '';
          const portMatch = address.match(/:(\d+)$/);
          if (portMatch) {
            return { pid, command: '', port: parseInt(portMatch[1]!, 10) };
          }
        }
      } else {
        const output = execSync(`lsof -p ${pid} -i -P -n 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 5000,
        });

        const lines = output.split('\n').filter((l) => l.includes('LISTEN'));
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const address = parts[8] ?? '';
          const portMatch = address.match(/:(\d+)$/);
          if (portMatch) {
            return { pid, command: parts[0] ?? '', port: parseInt(portMatch[1]!, 10) };
          }
        }
      }

      return null;
    } catch (error) {
      getLogger().error({ error, pid }, 'PID detection failed');
      return null;
    }
  }
}
