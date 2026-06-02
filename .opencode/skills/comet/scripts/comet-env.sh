#!/bin/bash
# Comet script locator — source this file to export paths to bundled scripts.
#
# Usage:
#   . /path/to/comet/scripts/comet-env.sh
#
# This file is sourced by workflow snippets. Do not set global shell options here.

_comet_env_source="${BASH_SOURCE[0]:-$0}"
_comet_script_dir="$(cd "$(dirname "$_comet_env_source")" && pwd -P)"
_comet_env_sourced=0
(return 0 2>/dev/null) && _comet_env_sourced=1

export COMET_GUARD="${COMET_GUARD:-${_comet_script_dir}/comet-guard.sh}"
export COMET_STATE="${COMET_STATE:-${_comet_script_dir}/comet-state.sh}"
export COMET_HANDOFF="${COMET_HANDOFF:-${_comet_script_dir}/comet-handoff.sh}"
export COMET_ARCHIVE="${COMET_ARCHIVE:-${_comet_script_dir}/comet-archive.sh}"
export COMET_YAML_VALIDATE="${COMET_YAML_VALIDATE:-${_comet_script_dir}/comet-yaml-validate.sh}"

_comet_env_fail() {
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed completely." >&2
  echo "Expected path pattern: */comet/scripts/comet-*.sh under project or platform skill directories" >&2
}

_comet_env_abort() {
  local _comet_env_was_sourced="$_comet_env_sourced"
  unset _comet_env_source _comet_script_dir _comet_script _comet_env_missing _comet_env_sourced
  unset -f _comet_env_fail
  if [ "$_comet_env_was_sourced" -eq 1 ]; then
    unset -f _comet_env_abort
    return 1
  fi
  exit 1
}

_comet_env_missing=0
for _comet_script in \
  "$COMET_GUARD" \
  "$COMET_STATE" \
  "$COMET_HANDOFF" \
  "$COMET_ARCHIVE" \
  "$COMET_YAML_VALIDATE"; do
  if [ ! -f "$_comet_script" ]; then
    _comet_env_fail
    _comet_env_missing=1
    break
  fi
done

if [ "$_comet_env_missing" -ne 0 ]; then
  _comet_env_abort
else
  unset _comet_env_source _comet_script_dir _comet_script _comet_env_missing _comet_env_sourced
  unset -f _comet_env_fail _comet_env_abort
fi
