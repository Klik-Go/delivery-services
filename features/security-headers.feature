@smoke
Feature: Security headers on every response
  Klik Go handles customer addresses, phone numbers and payments,
  so every page and API response must tell the browser to lock things down.

  Scenario Outline: <surface> responses carry the security headers
    Given the platform is running
    When I request "<path>"
    Then the response has a Content-Security-Policy with a per-request nonce
    And the Content-Security-Policy forbids framing the app
    And the response has these headers:
      | header                    | value                                        |
      | Strict-Transport-Security | max-age=63072000; includeSubDomains; preload |
      | X-Frame-Options           | DENY                                         |
      | Referrer-Policy           | strict-origin-when-cross-origin              |
      | X-Content-Type-Options    | nosniff                                      |
    And the response does not reveal the server framework

    Examples:
      | surface | path        |
      | Page    | /           |
      | API     | /api/health |

  Scenario: Each request gets a fresh nonce
    Given the platform is running
    When I request "/" twice
    Then the two Content-Security-Policy nonces are different
