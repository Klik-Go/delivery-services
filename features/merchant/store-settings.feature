@auth
Feature: Store settings
  Owners set their hours, prep time, cash on delivery and delivery radius; any team member opens
  or closes the store (docs/BUSINESS.md §9.2.2).

  Background:
    Given the owner of "Aling Nena's Karinderya" signed in with their authenticator app

  Scenario: An owner sets lunch and dinner hours, prep time and delivery radius
    When they save hours of 10:00–14:00 and 17:00–21:00 from Monday to Saturday, closed on Sunday
    And they set a 20 minute prep time, no cash on delivery and a 3 km delivery radius
    Then the store settings show those hours, 20 minutes, no cash on delivery and 3 km

  Scenario: The delivery radius cannot go beyond the zone
    When they set a 9 km delivery radius
    Then the request is refused with code "VALIDATION_FAILED"

  Scenario: A holiday closure is listed until it is removed
    When they close the store on Christmas Day for "Pasko"
    Then Christmas Day is listed as a closure
    When they remove the Christmas Day closure
    Then Christmas Day is no longer listed

  Scenario: Staff can open and close the store but not change its settings
    Given a staff member of "Aling Nena's Karinderya" signed in with their authenticator app
    When the staff member opens the store
    Then the store is open
    When the staff member tries to change the prep time
    Then they are refused with status 403
