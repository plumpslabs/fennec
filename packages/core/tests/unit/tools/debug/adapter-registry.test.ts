/**
 * Tests for AdapterRegistry — runtime detection and factory.
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('Adapter Registry', () => {
  let AdapterRegistry: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/tools/debug/adapter-registry.js');
    AdapterRegistry = mod.AdapterRegistry;
  });

  describe('runtime detection', () => {
    it('should detect node from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('node server.js')).toBe('node');
      expect(registry.detectRuntime('tsx src/index.ts')).toBe('node');
      expect(registry.detectRuntime('ts-node app.ts')).toBe('node');
    });

    it('should detect python from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('python app.py')).toBe('python');
      expect(registry.detectRuntime('python3 manage.py runserver')).toBe('python');
      expect(registry.detectRuntime('flask run')).toBe('python');
      expect(registry.detectRuntime('uvicorn main:app')).toBe('python');
      expect(registry.detectRuntime('gunicorn app:app')).toBe('python');
    });

    it('should detect php from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('php artisan serve')).toBe('php');
      expect(registry.detectRuntime('php index.php')).toBe('php');
    });

    it('should detect go from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('go run main.go')).toBe('go');
      expect(registry.detectRuntime('go build .')).toBe('go');
    });

    it('should detect java from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('java -jar app.jar')).toBe('java');
      expect(registry.detectRuntime('mvn spring-boot:run')).toBe('java');
      expect(registry.detectRuntime('gradle bootRun')).toBe('java');
    });

    it('should detect dotnet from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('dotnet run')).toBe('dotnet');
      expect(registry.detectRuntime('dotnet watch run')).toBe('dotnet');
    });

    it('should detect ruby from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('ruby app.rb')).toBe('ruby');
      expect(registry.detectRuntime('rails server')).toBe('ruby');
      expect(registry.detectRuntime('bundle exec puma')).toBe('ruby');
    });

    it('should detect rust from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('cargo run')).toBe('rust');
      expect(registry.detectRuntime('cargo build')).toBe('rust');
      expect(registry.detectRuntime('rustc main.rs')).toBe('rust');
    });

    it('should detect dart/flutter from command', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('dart run')).toBe('dart');
      expect(registry.detectRuntime('flutter run')).toBe('dart');
    });

    it('should return unknown for unrecognized commands', () => {
      const registry = new AdapterRegistry();
      expect(registry.detectRuntime('make build')).toBe('unknown');
      expect(registry.detectRuntime('echo hello')).toBe('unknown');
      expect(registry.detectRuntime('ls -la')).toBe('unknown');
    });
  });

  describe('isRuntimeSupported', () => {
    it('should support all defined runtimes', () => {
      const registry = new AdapterRegistry();
      expect(registry.isRuntimeSupported('node')).toBe(true);
      expect(registry.isRuntimeSupported('python')).toBe(true);
      expect(registry.isRuntimeSupported('php')).toBe(true);
      expect(registry.isRuntimeSupported('go')).toBe(true);
      expect(registry.isRuntimeSupported('java')).toBe(true);
      expect(registry.isRuntimeSupported('dotnet')).toBe(true);
      expect(registry.isRuntimeSupported('ruby')).toBe(true);
      expect(registry.isRuntimeSupported('rust')).toBe(true);
      expect(registry.isRuntimeSupported('cpp')).toBe(true);
      expect(registry.isRuntimeSupported('dart')).toBe(true);
    });

    it('should not support unknown runtime', () => {
      const registry = new AdapterRegistry();
      expect(registry.isRuntimeSupported('unknown')).toBe(false);
      expect(registry.isRuntimeSupported('elixir' as any)).toBe(false);
    });
  });

  describe('createAdapter', () => {
    it('should return null for unsupported runtime', async () => {
      const registry = new AdapterRegistry();
      const result = await registry.createAdapter('unknown');
      expect(result).toBeNull();
    });

    it('should return null for node without CDP', async () => {
      const registry = new AdapterRegistry();
      const result = await registry.createAdapter('node');
      expect(result).toBeNull();
    });

    it('should create PHP adapter', async () => {
      const registry = new AdapterRegistry();
      const adapter = await registry.createAdapter('php');
      expect(adapter).not.toBeNull();
      expect(adapter.runtime).toBe('php');
    });
  });
});
