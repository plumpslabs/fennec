# Security Policy

## Supported Versions

| Version | Supported             |
| ------- | --------------------- |
| 0.1.x   | ✅ Active development |

## Reporting a Vulnerability

Fennec gives AI agents powerful access to browser automation, process management, and file system operations. Security is a top priority.

If you discover a security vulnerability, please do **not** open a public issue. Instead, report it privately by emailing [INSERT SECURITY EMAIL].

Please include the following details in your report:

- Type of issue (e.g., sandbox escape, credential leak, unauthorized file access)
- Full description of the vulnerability
- Steps to reproduce
- Affected versions
- Any potential mitigations you've identified

## Response Timeline

- **24 hours**: Initial acknowledgment of your report
- **72 hours**: Preliminary assessment and severity classification
- **7 days**: Fix released for critical/high severity issues
- **14 days**: Fix released for medium/low severity issues

## Scope

Fennec's security model is documented in our [Security Model documentation](./docs/security-model.md). The following are in scope:

- Sandbox escape vulnerabilities
- Unauthorized process spawning or killing
- Unauthorized file system access outside configured paths
- Credential leakage through exported session data
- CDP raw access bypassing security controls

## Out of Scope

- Social engineering attacks
- Physical security attacks
- Vulnerabilities in third-party dependencies (report to the respective maintainers)

## Recognition

We believe in responsible disclosure. Reporters of verified security vulnerabilities will be acknowledged in our release notes (unless anonymity is requested).
