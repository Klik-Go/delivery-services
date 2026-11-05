@db
Feature: Finding the nearest available rider
  The dispatch engine assigns the nearest available rider (docs/BUSINESS.md §5.2, step 4).
  Only approved, online riders who were seen in the last 2 minutes and are not already
  delivering can get an offer.

  Background:
    Given the pilot zone from the seed data
    And a merchant "Lutong Bahay" at the centre of the pilot zone
    And these are the only riders on duty around "Lutong Bahay":
      | rider | status      | online | metres away | last seen   | delivering |
      | Ana   | active      | yes    | 800         | 10 s ago    | no         |
      | Ben   | active      | yes    | 300         | 10 s ago    | no         |
      | Carlo | active      | yes    | 1500        | 10 s ago    | no         |
      | Dina  | active      | no     | 100         | 10 s ago    | no         |
      | Eli   | pending_kyc | no     | 50          | 10 s ago    | no         |
      | Fe    | active      | yes    | 200         | 600 s ago   | no         |
      | Gio   | active      | yes    | 150         | 10 s ago    | yes        |

  Scenario: The nearest available riders are offered first
    When dispatch looks for the 3 nearest available riders to "Lutong Bahay"
    Then the riders offered are, nearest first: Ben, Ana, Carlo

  Scenario: Riders beyond the search radius are not offered
    When dispatch looks for available riders within 1000 m of "Lutong Bahay"
    Then the riders offered are, nearest first: Ben, Ana
