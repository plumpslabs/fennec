import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

      // Fallback: lsof may be absent (common on minimal Linux images) or the
      // process may not own an fd lsof can see. Parse /proc/<pid>/net/tcp*
      // directly — this reads the kernel's listening socket table and works
      // without any external binary.
      const procPort = this.detectByPidProc(pid);
      if (procPort !== null) return procPort;

      return null;
    } catch (error) {
      getLogger().error({ error, pid }, 'PID detection failed');
      return null;
    }
  }

  /**
   * Detect the listening port for a PID by reading /proc/<pid>/net/tcp and
   * /proc/<pid>/net/tcp6. This is the cross-distro fallback for when `lsof`
   * is unavailable, and is the primary reason tracked Node dev servers
   * (Vite, Express, ...) previously reported `port: null`.
   */
  private detectByPidProc(pid: number): PortProcessInfo | null {
    for (const proto of ['tcp', 'tcp6']) {
      const path = `/proc/${pid}/net/${proto}`;
      if (!existsSync(path)) continue;
      try {
        const content = readFileSync(path, 'utf-8');
        // Each line after the header: sl local_address rem_address st ...
        // local_address is "0100007F:1F90" => IP:PORT in hex (network byte order).
        // st (state) == 0A means TCP_LISTEN.
        for (const line of content.split('\n').slice(1)) {
          const cols = line.trim().split(/\s+/);
          if (cols.length < 4) continue;
          const state = cols[3];
          if (state !== '0A') continue; // only LISTEN sockets
          const local = cols[1]!;
          const portHex = local.split(':')[1];
          if (!portHex) continue;
          const port = parseInt(portHex, 16);
          if (!isNaN(port) && port > 0) {
            return { pid, command: '', port };
          }
        }
      } catch {
        // Continue to the next protocol file.
      }
    }
    return null;
  }
}
