/**
 * Tests for Adapter Types — RUNTIME_DETECTORS and type interfaces.
 */
import { describe, it, expect } from 'vitest';

describe('Adapter Types', () => {
  let RUNTIME_DETECTORS: any;
  let RuntimeType: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/tools/debug/adapter-types.js');
    RUNTIME_DETECTORS = mod.RUNTIME_DETECTORS;
  });

  describe('RUNTIME_DETECTORS', () => {
    it('should have detectors for all runtimes', () => {
      const runtimes = RUNTIME_DETECTORS.map((d: any) => d.runtime);
      expect(runtimes).toContain('node');
      expect(runtimes).toContain('python');
      expect(runtimes).toContain('php');
      expect(runtimes).toContain('go');
      expect(runtimes).toContain('java');
      expect(runtimes).toContain('dotnet');
      expect(runtimes).toContain('ruby');
      expect(runtimes).toContain('rust');
      expect(runtimes).toContain('dart');
    });

    it('should have matchesCommand function for each detector', () => {
      for (const d of RUNTIME_DETECTORS) {
        expect(typeof d.matchesCommand).toBe('function');
        expect(typeof d.isToolInstalled).toBe('function');
      }
    });

    it('should detect node commands correctly', () => {
      const node = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'node');
      expect(node.matchesCommand('node app.js')).toBe(true);
      expect(node.matchesCommand('tsx src/index.ts')).toBe(true);
      expect(node.matchesCommand('ts-node app.ts --port 3000')).toBe(true);
      expect(node.matchesCommand('python app.py')).toBe(false);
    });

    it('should detect python commands correctly', () => {
      const py = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'python');
      expect(py.matchesCommand('python manage.py')).toBe(true);
      expect(py.matchesCommand('python3 app.py')).toBe(true);
      expect(py.matchesCommand('flask run --port 5000')).toBe(true);
      expect(py.matchesCommand('uvicorn main:app --reload')).toBe(true);
      expect(py.matchesCommand('django-admin startproject')).toBe(true);
      expect(py.matchesCommand('node server.js')).toBe(false);
    });

    it('should detect php commands correctly', () => {
      const php = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'php');
      expect(php.matchesCommand('php artisan serve')).toBe(true);
      expect(php.matchesCommand('php -S localhost:8000')).toBe(true);
      expect(php.matchesCommand('composer install')).toBe(true);
      expect(php.matchesCommand('symfony server:start')).toBe(true);
      expect(php.matchesCommand('python app.py')).toBe(false);
    });

    it('should detect go commands correctly', () => {
      const go = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'go');
      expect(go.matchesCommand('go run main.go')).toBe(true);
      expect(go.matchesCommand('go build .')).toBe(true);
      expect(go.matchesCommand('air --port 8080')).toBe(true);
      expect(go.matchesCommand('node server.js')).toBe(false);
    });

    it('should detect java commands correctly', () => {
      const java = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'java');
      expect(java.matchesCommand('java -jar app.jar')).toBe(true);
      expect(java.matchesCommand('mvn spring-boot:run')).toBe(true);
      expect(java.matchesCommand('gradle bootRun')).toBe(true);
      expect(java.matchesCommand('kotlin -cp app.jar MainKt')).toBe(true);
      expect(java.matchesCommand('go run main.go')).toBe(false);
    });

    it('should detect dotnet commands correctly', () => {
      const dn = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'dotnet');
      expect(dn.matchesCommand('dotnet run')).toBe(true);
      expect(dn.matchesCommand('dotnet watch run')).toBe(true);
      expect(dn.matchesCommand('dotnet build')).toBe(true);
      expect(dn.matchesCommand('python app.py')).toBe(false);
    });

    it('should detect ruby commands correctly', () => {
      const rb = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'ruby');
      expect(rb.matchesCommand('ruby app.rb')).toBe(true);
      expect(rb.matchesCommand('rails server')).toBe(true);
      expect(rb.matchesCommand('rake db:migrate')).toBe(true);
      expect(rb.matchesCommand('rspec spec/')).toBe(true);
      expect(rb.matchesCommand('bundle exec puma')).toBe(true);
      expect(rb.matchesCommand('node server.js')).toBe(false);
    });

    it('should detect rust commands correctly', () => {
      const rs = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'rust');
      expect(rs.matchesCommand('cargo run')).toBe(true);
      expect(rs.matchesCommand('cargo build --release')).toBe(true);
      expect(rs.matchesCommand('rustc main.rs')).toBe(true);
      expect(rs.matchesCommand('python app.py')).toBe(false);
    });

    it('should detect dart/flutter commands correctly', () => {
      const da = RUNTIME_DETECTORS.find((d: any) => d.runtime === 'dart');
      expect(da.matchesCommand('dart run')).toBe(true);
      expect(da.matchesCommand('dart compile exe bin/main.dart')).toBe(true);
      expect(da.matchesCommand('flutter run')).toBe(true);
      expect(da.matchesCommand('flutter build apk')).toBe(true);
      expect(da.matchesCommand('node server.js')).toBe(false);
    });
  });
});
