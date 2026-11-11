@auth @ops
Feature: Rider applications are reviewed against the onboarding checklist
  New riders apply from the rider app and upload their documents (docs/BUSINESS.md Appendix B).
  The zone coordinator reviews each one through short-lived links; every view and decision is
  audited, and the files are never public.

  Background:
    Given a new rider applies in "Makati City" with a motorcycle and uploads their documents
    And the Makati coordinator is signed in

  Scenario: The application waits in the KYC queue with its checklist
    When the coordinator opens the rider queue
    Then the new rider is waiting with 5 documents to check

  Scenario: Documents open only through a 60-second link, and every view is audited
    When the coordinator opens the rider's "government_id"
    Then the link works now and expires 60 seconds after it was made
    And the document has no public address
    And the audit log records "kyc.view" by the coordinator

  Scenario: A rider is approved once every document passes
    When the coordinator approves the rider
    Then the request is refused with code "CONFLICT"
    When the coordinator accepts every document
    And the coordinator approves the rider
    Then the new rider can go online
    And the audit log records "rider.approve" by the coordinator

  Scenario: A rejected document goes back to the rider with the reason
    When the coordinator rejects the rider's "selfie_with_id" because "Face is not visible"
    Then the rider sees "selfie_with_id" rejected because "Face is not visible"
    And the new rider cannot go online

  Scenario: A suspended rider cannot go online
    Given the coordinator accepts every document
    And the coordinator approves the rider
    When the coordinator suspends the rider because "Repeated no-shows"
    Then the new rider cannot go online
    And the audit log records "rider.suspend" by the coordinator because "Repeated no-shows"

  Scenario: Low-rated riders show up for coaching
    Given "Rico Rider" has an average rating of 3.2 from 12 ratings
    When the coordinator opens the coaching list
    Then "Rico Rider" is on the coaching list
