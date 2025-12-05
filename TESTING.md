# Testing Guide

## Overview

We use **Test-Driven Development (TDD)** with **Arrange-Act-Assert (AAA)** pattern to ensure code reliability and prevent regressions.

## Running Tests

```powershell
node tests/print-progress.test.js
```

All tests should pass before committing changes.

## Test Structure (AAA Pattern)

Each test follows the Arrange-Act-Assert pattern:

```javascript
function test_example() {
    console.log('TEST: Description of what we're testing');
    
    // Arrange - Set up test data and expected values
    const input = { value: 10 };
    
    // Act - Execute the code being tested
    const result = someFunction(input);
    
    // Assert - Verify the result matches expectations
    assertEqual(result, expectedValue, 'Should do the expected thing');
    console.log('✓ PASS\n');
}
```

## Test Categories

### Progress Calculation Tests (4 tests)
- `test_progress_from_virtualsdcard` - Verifies using virtualSdcard.progress directly
- `test_progress_fallback_when_no_file_size` - Ensures fallback when file_size is 0
- `test_progress_handles_null_values` - Tests null/undefined handling
- `test_progress_clamping` - Verifies 0-1 range clamping

### Layer Calculation Tests (2 tests)
- `test_layer_count_calculation` - Tests layer count from object_height and layer_height
- `test_layer_count_common_height_fallback` - Verifies common height assumptions (0.2mm, 0.15mm, etc.)

### Time Parsing Tests (3 tests)
- `test_filename_time_parsing_with_days` - Tests "1d1h42m" format parsing
- `test_filename_time_parsing_hours_minutes` - Tests "2h30m" format parsing
- `test_filename_layer_height_extraction` - Tests "0.2mm" and "0.15" extraction

### Time Calculation Tests (4 tests)
- `test_format_time_hh_mm` - Tests formatting seconds as "2h 30m"
- `test_format_time_with_days` - Tests formatting with days "1d 1h 42m"
- `test_calculate_remaining_from_progress` - Tests remaining time calculation from progress
- `test_remaining_time_edge_cases` - Tests 0% and 100% progress edge cases

### Layer Info Formatting Tests (3 tests)
- `test_format_layer_info_complete` - Tests "150 / 300" format
- `test_format_layer_info_no_total` - Tests "150 / --" when total missing
- `test_format_layer_info_all_missing` - Tests "--" when all data missing

### Metadata Parsing Tests (3 tests)
- `test_parse_gcode_layer_height` - Tests parsing "layer_height = 0.2" from gcode
- `test_calculate_layer_count_from_heights` - Tests layer count calculation formula
- `test_parse_gcode_estimated_time` - Tests parsing "2h 30m 15s" from gcode comments

### Percentage Calculation Tests (2 tests)
- `test_progress_to_percentage` - Tests 0.667 → 67% conversion
- `test_percentage_rounding` - Tests rounding edge cases (0.995 → 100%)

### Null Safety Tests (2 tests)
- `test_nullish_coalescing_chain` - Tests ?? operator fallback chains
- `test_optional_chaining_nested` - Tests ?. operator with nested objects

**Total: 23 comprehensive tests covering all critical functionality**

## Writing New Tests

When adding features or fixing bugs:

1. **Write the test first** (TDD approach)
2. **Run the test** - it should fail initially
3. **Implement the fix** in print-progress.js
4. **Run the test again** - it should now pass
5. **Commit both** the test and the fix together

### Example: Adding a new feature

```javascript
function test_new_feature() {
    console.log('TEST: New feature description');
    
    // Arrange
    const input = setupTestData();
    
    // Act
    const result = newFeature(input);
    
    // Assert
    assertEqual(result, expected, 'Should behave as expected');
    console.log('✓ PASS\n');
}
```

Then add it to the `tests` array in `runAllTests()`.

## Why TDD?

1. **Prevents Regressions** - Tests catch when changes break existing functionality
2. **Documents Behavior** - Tests serve as executable documentation
3. **Confidence in Changes** - Refactor safely knowing tests will catch issues
4. **Faster Debugging** - Isolated tests pinpoint exactly what broke

## Test Utilities

- `assertEqual(actual, expected, message)` - Strict equality check
- `assertApproximatelyEqual(actual, expected, tolerance, message)` - Float comparison with tolerance

## CI/CD Integration (Future)

Consider adding to `.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: node print-progress.test.js
```

## Coverage Goals

Aim for:
- **Critical calculations**: 100% coverage (progress, layers, times)
- **Parsing logic**: 100% coverage (filenames, gcode headers)
- **Fallback logic**: 100% coverage (null handling, defaults)
- **UI updates**: Manual testing (browser-based)
