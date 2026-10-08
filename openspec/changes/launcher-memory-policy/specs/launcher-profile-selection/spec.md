# Spec Delta

## Purpose

Lets a process choose a config profile at start-up, so a spawning extension can launch a session with a policy the config file does not select.

## ADDED Requirements

### Requirement: Profile selection by environment variable
Magic Context SHALL select the config profile named by `MAGIC_CONTEXT_PROFILE` when the variable is set, and SHALL apply that profile's overlay after the project config tier.

#### Scenario: Variable selects a profile
- **WHEN** `MAGIC_CONTEXT_PROFILE` names a profile that exists in the user config
- **THEN** the resolved config is the normal resolution with that profile's overlay applied last

#### Scenario: Launcher policy beats project config
- **WHEN** `MAGIC_CONTEXT_PROFILE` names a profile that sets `memory.read_only: true` and the project config sets `memory.read_only: false`
- **THEN** the resolved value is `true`

#### Scenario: Unknown profile name
- **WHEN** `MAGIC_CONTEXT_PROFILE` names a profile that does not exist
- **THEN** the session loads with normal profile resolution, and a warning naming the missing profile is logged

#### Scenario: Variable unset
- **WHEN** `MAGIC_CONTEXT_PROFILE` is not set
- **THEN** profile resolution is unchanged from before this capability existed
