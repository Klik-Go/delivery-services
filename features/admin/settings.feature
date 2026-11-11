@auth @ops
Feature: Admins change platform settings and staff access
  Feature flags such as dispatch timings are edited in the console and checked before saving;
  staff roles can be revoked (docs/BUSINESS.md §9.2.4).

  Background:
    Given an admin is signed in

  Scenario: Change the dispatch offer time
    When the admin sets the dispatch offer time to 45 seconds
    Then the dispatch settings give riders 45 seconds to answer
    And the audit log records "feature_flag.update" by the admin

  Scenario: Impossible settings are refused
    When the admin sets the dispatch offer time to 2 seconds
    Then the request is refused with code "VALIDATION_FAILED"

  Scenario: Revoke a coordinator's access
    Given a coordinator of "San Marcelino, Zambales" is signed in
    When the admin revokes their "coordinator" role for "San Marcelino, Zambales"
    Then the coordinator can no longer open the order board
    And the audit log records "role.revoke" by the admin
