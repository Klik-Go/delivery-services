@auth @finance
Feature: Weekly settlement from the ledger
  Each week (Monday to Sunday, Asia/Manila) every store is paid its subtotal less commission and
  every rider their pay and tips, exactly as the ledger says they are owed (docs/BUSINESS.md §5.2
  step 7, §5.3–5.4).

  Background:
    Given an admin is signed in
    And a finished week in which "Aling Nena's Karinderya" earned 15000 and 9000 centavos from two orders
    And rider "Rosa" earned 12000 centavos on online orders that week

  Scenario: The settlement pays what the ledger owes, once
    When the admin settles that week
    Then "Aling Nena's Karinderya" is to be paid 24000 centavos with 2 order lines
    And "Rosa" is to be paid 12000 centavos
    And every payout equals what the ledger moved out of the payable accounts
    And settling the same week again is refused with "This week was already settled."
