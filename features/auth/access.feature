@auth
Feature: Each role only reaches its own screens
  Customers, riders, merchants and admins each have their own surface, and the server
  re-reads roles from the database on every request (never from the browser).

  Scenario Outline: A rider cannot open <screen>
    Given a rider signed in with a phone code
    When they open "<path>"
    Then they are refused with status 403

    Examples:
      | screen                 | path      |
      | the merchant dashboard | /merchant |
      | the admin console      | /admin    |

  Scenario: A rider can open the rider app
    Given a rider signed in with a phone code
    When they open "/rider"
    Then the page opens

  Scenario: A visitor who is not signed in is sent to sign in
    When a visitor who is not signed in opens "/rider"
    Then they are sent to "/auth/sign-in"
