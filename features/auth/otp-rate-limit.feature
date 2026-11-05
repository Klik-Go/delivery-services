@auth
Feature: One-time codes are rate-limited
  Every code costs money (Semaphore SMS) and codes can be brute-forced, so Klik Go
  caps code requests: 5 per hour per phone, 20 per hour per network (docs/BUILD_PLAN.md §6 Phase 2).

  Scenario: A phone number can ask for at most 5 codes an hour
    Given a phone number that has not asked for a code yet
    When it asks for a code 5 times
    Then every request is accepted
    When it asks for a code once more
    Then the request is refused with code "RATE_LIMITED"

  Scenario: One network can ask for at most 20 codes an hour
    Given a network that has not asked for codes yet
    When 20 different phone numbers on that network ask for a code
    Then every request is accepted
    When one more phone number on that network asks for a code
    Then the request is refused with code "RATE_LIMITED"
