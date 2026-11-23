@auth @privacy
Feature: Your data, your choice
  Klik Go holds people's names, phone numbers, addresses and riders' ID documents. Under the Data
  Privacy Act (RA 10173) people agree to how we use their data, can take a copy of it and can ask
  us to erase it; we keep only the records the law makes us keep (docs/BUSINESS.md §7.2, §12).

  Scenario: A new customer agrees to the terms and privacy notice before ordering
    Given a new customer signs in with their phone
    Then they are asked to agree to the terms and the privacy notice first
    When they agree to the current terms and privacy notice
    Then their agreement to both documents is recorded with today's version
    And signing in again takes them straight to the app

  Scenario: A customer downloads a copy of their data
    Given a signed-in customer with a saved address and a delivered order
    When they download their data
    Then the file holds their profile, their saved address and their order
    And the file holds no other customer's details
    And the audit log records "privacy.export" for them

  Scenario: A customer deletes their account
    Given a signed-in customer with a saved address and a delivered order
    When they delete their account and type "DELETE" to confirm
    Then they are signed out and cannot sign in to that account again
    And their name, phone number and saved addresses are erased
    And their order keeps its amounts but no longer holds their address
    And the audit log records "privacy.erase" for them

  Scenario: An account with an order on its way cannot be deleted yet
    Given a signed-in customer with an order on its way
    When they delete their account and type "DELETE" to confirm
    Then the deletion is refused with "You have an order in progress"

  Scenario: Deleting needs the typed confirmation
    Given a signed-in customer with a saved address and a delivered order
    When they delete their account and type "delete me" to confirm
    Then the deletion is refused with "Type DELETE to confirm"

  Scenario: Staff accounts are removed by an admin, not by the person
    Given a store owner is signed in
    When they delete their account and type "DELETE" to confirm
    Then the deletion is refused with "Ask an admin to remove your staff access first"

  Scenario: ID documents from a rejected rider application are deleted after the retention period
    Given a rider application rejected 91 days ago with an uploaded government ID
    When the background jobs run
    Then the ID file is deleted from storage and the document is marked purged
    And the audit log records "kyc.purged"
