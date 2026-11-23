@security
Feature: Protecting the API
  Every public API route is rate limited, changes are accepted only from Klik Go's own pages, and
  uploaded files must really be what they say they are (OWASP ASVS L1, docs/SECURITY.md).

  Scenario: Too many changes from one network in a minute are slowed down
    Given a visitor on their own network
    When they send 61 changes within a minute
    Then the 61st change is refused with status 429 and a Retry-After header

  Scenario: A change sent from another website is refused
    When another website makes a visitor's browser send a change to Klik Go
    Then the change is refused with status 403

  Scenario: A change from Klik Go's own pages is accepted
    When Klik Go's own page sends a change
    Then the change is not refused as cross-site

  @auth
  Scenario: A file that only pretends to be a photo is refused
    Given a rider applicant is signed in
    When they upload a web page renamed to "id.jpg" as their government ID
    Then the upload is refused with "That file is not a photo or a PDF"

  Scenario: The deep health check covers the database and file storage
    When monitoring calls GET "/api/health/ready"
    Then the response status is 200
    And file storage is reported "ok"
