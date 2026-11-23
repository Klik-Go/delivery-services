@auth @finance
Feature: Paying stores and riders
  Admins export the week's transfer list, send the money by hand (GCash, Maya or bank) and mark
  each payout paid with the transfer reference. A paid payout never changes; a failed one goes back
  to what the store is owed and is paid the next week. Owners see their weekly statements.

  Background:
    Given an admin is signed in
    And a finished week in which "Aling Nena's Karinderya" earned 15000 and 9000 centavos from two orders
    And "Aling Nena's Karinderya" is paid by GCash to "Nena Santos" 09170000011
    And the admin settles that week

  Scenario: Export, pay once, and the owner's statement
    When the admin downloads the transfer list
    Then the CSV opens cleanly in a spreadsheet and lists "Aling Nena's Karinderya" for 240.00
    When the admin marks the "Aling Nena's Karinderya" payout paid with reference "GC-0001"
    Then marking it paid again is refused with "This payout was already marked paid."
    And the owner of "Aling Nena's Karinderya" sees that week's statement as paid with reference "GC-0001"
    And the owner can download the statement as a CSV totalling 240.00
    And the audit log records "payout.paid" by the admin

  Scenario: A failed payout is owed again
    When the admin marks the "Aling Nena's Karinderya" payout failed because "Wrong GCash number"
    Then "Aling Nena's Karinderya" is owed 24000 centavos again
