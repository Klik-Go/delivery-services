@auth
Feature: Where Klik Go delivers
  A pin decides which zone serves an address. Outside every zone, customers can ask us to come to
  them (docs/BUILD_PLAN.md Phase 4, docs/BUSINESS.md §5.5).

  Scenario: A pin in Makati is served by the Makati zone
    When someone checks a pin on Ayala Avenue, Makati
    Then they are told Klik Go delivers there from "Makati City"

  Scenario: A pin outside every zone is invited to join the waitlist
    When someone checks a pin in Kapitolyo, Pasig
    Then they are told "We're not in your area yet — join the waitlist"
    When they join the waitlist as "Ana Reyes" from barangay "Kapitolyo"
    Then their waitlist request is recorded

  Scenario: A signed-in customer saves an address with a landmark and contact number
    Given a customer signed in with a phone code
    When they save "Home" on Ayala Avenue with the landmark "Beside the 7-Eleven" and contact number "0917 000 0103"
    Then "Home" is their default address

  Scenario: An address without a landmark is refused
    Given a customer signed in with a phone code
    When they save an address on Ayala Avenue without a landmark
    Then the request is refused with code "VALIDATION_FAILED"
