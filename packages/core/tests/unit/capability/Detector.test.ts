import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityDetector } from '../../../src/capability/Detector.js';

describe('CapabilityDetector', () => {
  let detector: CapabilityDetector;

  beforeEach(() => {
    detector = new CapabilityDetector();
  });

  describe('detect', () => {
    it('should return a report with all frameworks listed', async () => {
      const report = await detector.detect('/tmp');
      expect(report.frameworks).toBeDefined();
      expect(report.frameworks.length).toBeGreaterThan(0);
      expect(report.environment).toBeDefined();
    });

    it('should detect the Fennec project itself', async () => {
      const report = await detector.detect(process.cwd());
      // Fennec uses Node.js, TypeScript, so Node should be detected
      expect(report.environment).toBeDefined();
      expect(typeof report.environment.hasNode).toBe('boolean');
      expect(typeof report.environment.platform).toBe('string');
    });

    it('should categorize frameworks correctly', async () => {
      const report = await detector.detect('/tmp');
      for (const fw of report.frameworks) {
        expect(['frontend', 'backend', 'mobile', 'tooling', 'database']).toContain(fw.category);
        expect(typeof fw.detected).toBe('boolean');
        expect(typeof fw.confidence).toBe('number');
        expect(fw.confidence).toBeGreaterThanOrEqual(0);
        expect(fw.confidence).toBeLessThanOrEqual(1);
        expect(Array.isArray(fw.features)).toBe(true);
      }
    });

    it('should return primary framework (highest confidence detected)', async () => {
      const report = await detector.detect('/tmp');
      if (report.primaryFramework) {
        expect(report.primaryFramework.detected).toBe(true);
      }
    });

    it('should return recommendedModules as an array', async () => {
      const report = await detector.detect('/tmp');
      expect(Array.isArray(report.recommendedModules)).toBe(true);
    });

    it('should cache results and return same report on second call', async () => {
      const report1 = await detector.detect('/tmp');
      const report2 = await detector.detect('/tmp');
      expect(report1).toBe(report2); // Same reference due to caching
    });
  });

  describe('detectEnvironment', () => {
    it('should detect platform and shell', async () => {
      const env = await detector.detectEnvironment();
      expect(env.platform).toBe(process.platform);
      expect(env.shell).toBeDefined();
    });

    it('should check for common tools', async () => {
      const env = await detector.detectEnvironment();
      expect(typeof env.hasNode).toBe('boolean');
      expect(typeof env.hasGit).toBe('boolean');
      expect(typeof env.hasDocker).toBe('boolean');
    });
  });

  describe('clearCache', () => {
    it('should invalidate cached report', async () => {
      const report1 = await detector.detect('/tmp');
      detector.clearCache();
      const report2 = await detector.detect('/tmp');
      expect(report1).not.toBe(report2);
    });
  });
});
