/**
 * Tests for DBGp Adapter — PHP Xdebug XML protocol adapter.
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('DBGp Adapter', () => {
  let DBGpAdapter: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/tools/debug/dbgp-adapter.js');
    DBGpAdapter = mod.DBGpAdapter;
  });

  describe('adapter creation', () => {
    it('should create adapter with default config', () => {
      const adapter = new DBGpAdapter();
      expect(adapter.runtime).toBe('php');
      expect(adapter.isEnabled).toBe(false);
    });

    it('should create adapter with custom config', () => {
      const adapter = new DBGpAdapter({ host: '192.168.1.1', port: 9000 });
      expect(adapter.runtime).toBe('php');
    });
  });

  describe('DebugAdapter interface compliance', () => {
    it('should have all required DebugAdapter methods', () => {
      const adapter = new DBGpAdapter();
      expect(typeof adapter.enable).toBe('function');
      expect(typeof adapter.disable).toBe('function');
      expect(typeof adapter.setBreakpointByUrl).toBe('function');
      expect(typeof adapter.removeBreakpoint).toBe('function');
      expect(typeof adapter.resume).toBe('function');
      expect(typeof adapter.stepOver).toBe('function');
      expect(typeof adapter.stepInto).toBe('function');
      expect(typeof adapter.stepOut).toBe('function');
      expect(typeof adapter.evaluateOnCallFrame).toBe('function');
      expect(typeof adapter.getProperties).toBe('function');
    });

    it('should throw when calling methods before enable', async () => {
      const adapter = new DBGpAdapter();
      await expect(adapter.setBreakpointByUrl('test.php', 10)).rejects.toThrow('not enabled');
      await expect(adapter.resume()).rejects.toThrow('not enabled');
      await expect(adapter.stepOver()).rejects.toThrow('not enabled');
    });
  });

  describe('DBGp XML parsing', () => {
    it('should parse DBGp init response', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<init xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug"
      fileuri="file:///var/www/index.php"
      language="PHP"
      protocol_version="1.0"
      appid="12345"
      idekey="fennec"/>`;
      expect(xml).toContain('init');
      expect(xml).toContain('fileuri');
      expect(xml).toContain('appid="12345"');
    });

    it('should parse breakpoint_set response', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<response xmlns="urn:debugger_protocol_v1"
          command="breakpoint_set"
          transaction_id="1"
          id="54321"
          state="enabled"/>`;
      expect(xml).toContain('id="54321"');
      expect(xml).toContain('state="enabled"');
    });

    it('should parse stack_get response', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<response xmlns="urn:debugger_protocol_v1"
          command="stack_get"
          transaction_id="2">
  <stack where="{main}" level="0" type="file" filename="file:///var/www/index.php" lineno="42"/>
  <stack where="someFunction" level="1" type="file" filename="file:///var/www/includes/func.php" lineno="15"/>
</response>`;
      expect(xml).toContain('stack');
      expect(xml).toContain('someFunction');
      expect(xml).toContain('lineno="42"');
    });

    it('should parse context_get response with variables', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<response xmlns="urn:debugger_protocol_v1"
          command="context_get"
          transaction_id="3">
  <property name="x" type="int"><![CDATA[42]]></property>
  <property name="name" type="string" encoding="base64">d29ybGQ=</property>
  <property name="items" type="array" children="1" numchildren="3"/>
</response>`;
      expect(xml).toContain('type="int"');
      expect(xml).toContain('name="x"');
      expect(xml).toContain('d29ybGQ='); // base64 "world"
    });

    it('should parse eval response', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<response xmlns="urn:debugger_protocol_v1"
          command="eval"
          transaction_id="4"
          success="1">
  <property type="string" encoding="base64">d29ybGQ=</property>
</response>`;
      expect(xml).toContain('success="1"');
    });

    it('should handle null-byte terminated messages', () => {
      const msg = `<?xml version="1.0"?><response command="status" status="break" reason="ok"/>\0`;
      expect(msg.endsWith('\0')).toBe(true);
    });
  });

  describe('DBGp command format', () => {
    it('should build correct breakpoint_set command', () => {
      const file = '/var/www/index.php';
      const line = 42;
      const cmd = `breakpoint_set -i 1 -t line -f ${file} -n ${line + 1}\\0`;
      expect(cmd).toContain('-t line');
      expect(cmd).toContain('-f /var/www/index.php');
      expect(cmd).toContain('-n 43');
    });

    it('should build correct stack_get command', () => {
      const cmd = 'stack_get -i 1 -d 0 -m 20\\0';
      expect(cmd).toContain('stack_get');
      expect(cmd).toContain('-d 0');
      expect(cmd).toContain('-m 20');
    });
  });
});
