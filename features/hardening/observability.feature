@observability
Feature: Seeing problems before customers do
  Operations sees failing webhooks, late background jobs and missed store deadlines in one place,
  and the product team sees where customers drop out of ordering, without personal data leaving
  Klik Go (docs/BUSINESS.md §13.2).

  Scenario: The app reports where a customer is in the ordering funnel
    When the app reports that a visitor viewed a store
    Then the event is accepted
    And an event that is not part of the funnel is refused

  Scenario: A crash in the browser is reported without personal details
    When the app reports a browser error that mentions the phone number "09171234567"
    Then the error report is accepted

  @auth
  Scenario: Admins see system health; coordinators do not
    Given the background jobs have run
    And an admin is signed in
    When the admin opens the system status
    Then it shows when the background jobs last ran
    And it lists failed payment webhooks and missed store deadlines
    And a coordinator cannot open the system status
