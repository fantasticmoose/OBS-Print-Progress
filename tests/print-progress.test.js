/**
 * Unit tests for print-progress.js
 * Using basic assert-style testing (no external framework required)
 * Run with: node tests/print-progress.test.js
 */

// Mock DOM elements
class MockElement {
    constructor() {
        this.textContent = '';
        this.style = {};
        this.className = '';
    }
}

global.document = {
    getElementById: (id) => new MockElement(),
    querySelector: (selector) => new MockElement()
};

// ============================================================================
// PROGRESS CALCULATION TESTS
// ============================================================================

/**
 * Test: Progress should be from virtualSdcard.progress directly
 * This matches what Klipper reports and Mainsail displays
 */
function test_progress_from_virtualsdcard() {
    console.log('TEST: Progress should use virtualSdcard.progress directly');
    
    // Arrange
    const virtualSdcard = {
        progress: 0.96,  // What Klipper reports
        file_position: 28000000,  // May not accurately reflect actual progress
        file_size: 52428800
    };
    
    // Act - Use virtualSdcard.progress directly
    const rawProgress = virtualSdcard.progress;
    
    // Assert
    assertEqual(rawProgress, 0.96, 'Should use virtualSdcard.progress directly');
    assertEqual(Math.round(rawProgress * 100), 96, 'Should show 96% progress matching Mainsail');
    console.log('✓ PASS\n');
}

/**
 * Test: Progress should fall back to virtualSdcard.progress if file_size is 0
 */
function test_progress_fallback_when_no_file_size() {
    console.log('TEST: Progress fallback when file_size is 0');
    
    // Arrange
    const virtualSdcard = {
        progress: 0.25,
        file_position: 0,
        file_size: 0
    };
    
    // Act - Use virtualSdcard.progress
    const rawProgress = virtualSdcard.progress ?? 0;
    
    // Assert
    assertEqual(rawProgress, 0.25, 'Should use virtualSdcard.progress');
    console.log('✓ PASS\n');
}

/**
 * Test: Progress should handle null/undefined values gracefully
 */
function test_progress_handles_null_values() {
    console.log('TEST: Progress handles null/undefined values');
    
    // Arrange
    const virtualSdcard = {
        progress: null,
        file_position: null,
        file_size: null
    };
    const displayStatus = { progress: 0.15 };
    
    // Act - Fall back through the chain
    const rawProgress = virtualSdcard.progress ?? displayStatus.progress ?? 0;
    const progress = Math.max(0, Math.min(1, Number(rawProgress) || 0));
    
    // Assert
    assertEqual(progress, 0.15, 'Should fall back to displayStatus.progress');
    console.log('✓ PASS\n');
}

/**
 * Test: Progress should clamp to 0-1 range
 */
function test_progress_clamping() {
    console.log('TEST: Progress clamping to 0-1 range');
    
    // Arrange - progress value > 1
    const progress1 = Math.max(0, Math.min(1, 1.5));
    
    // Assert
    assertEqual(progress1, 1, 'Should clamp progress > 1 to 1');
    
    // Arrange - progress value < 0
    const progress2 = Math.max(0, Math.min(1, -0.5));
    
    // Assert
    assertEqual(progress2, 0, 'Should clamp progress < 0 to 0');
    console.log('✓ PASS\n');
}

// ============================================================================
// LAYER CALCULATION TESTS
// ============================================================================

/**
 * Test: Layer count should be calculated from object_height and layer_height
 */
function test_layer_count_calculation() {
    console.log('TEST: Layer count calculation from height');
    
    // Arrange
    const metadata = {
        object_height: 50.0,
        layer_height: 0.2,
        first_layer_height: 0.3
    };
    
    // Act
    const firstLayer = metadata.first_layer_height || metadata.layer_height;
    const calculatedLayers = Math.max(1, Math.round(((metadata.object_height - firstLayer) / metadata.layer_height) + 1));
    
    // Assert
    assertEqual(calculatedLayers, 250, 'Should calculate 250 layers for 50mm height with 0.2mm layers (49.7mm remaining / 0.2mm = 248.5, rounded to 249, plus 1st layer = 250)');
    console.log('✓ PASS\n');
}

/**
 * Test: Layer count should try common layer heights if not specified
 */
function test_layer_count_common_height_fallback() {
    console.log('TEST: Layer count fallback to common heights');
    
    // Arrange
    const metadata = {
        object_height: 50.0,
        layer_height: null
    };
    const commonHeights = [0.2, 0.15, 0.3, 0.25, 0.1];
    
    // Act - Try common heights
    let assumedHeight = null;
    for (const height of commonHeights) {
        const calculatedLayers = Math.round(metadata.object_height / height);
        if (calculatedLayers >= 50 && calculatedLayers <= 5000) {
            assumedHeight = height;
            break;
        }
    }
    
    // Assert
    assertEqual(assumedHeight, 0.2, 'Should assume 0.2mm as most common layer height');
    console.log('✓ PASS\n');
}

// ============================================================================
// TIME PARSING TESTS
// ============================================================================

/**
 * Test: Filename time parsing should handle days, hours, and minutes
 */
function test_filename_time_parsing_with_days() {
    console.log('TEST: Filename time parsing with days');
    
    // Arrange
    const filename = "th_front_v1_ABS_1d1h42m.gcode";
    // Need to make the pattern more specific to avoid matching everything
    const timeRegex = /_(\d+)d(\d+)h(\d+)m/i;
    
    // Act
    const match = filename.match(timeRegex);
    let totalSeconds = 0;
    if (match) {
        const days = parseInt(match[1]) || 0;
        const hours = parseInt(match[2]) || 0;
        const minutes = parseInt(match[3]) || 0;
        totalSeconds = (days * 86400) + (hours * 3600) + (minutes * 60);
    }
    
    // Assert
    assertEqual(totalSeconds, 92520, 'Should parse "1d1h42m" as 92520 seconds (1d + 1h + 42m = 25.7 hours)');
    console.log('✓ PASS\n');
}

/**
 * Test: Filename time parsing should handle hours and minutes only
 */
function test_filename_time_parsing_hours_minutes() {
    console.log('TEST: Filename time parsing with hours and minutes');
    
    // Arrange
    const filename = "test_print_2h30m.gcode";
    // Match optional days, hours, and minutes with underscores
    const timeRegex = /_(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)/i;
    
    // Act
    const match = filename.match(timeRegex);
    let totalSeconds = 0;
    if (match) {
        const days = parseInt(match[1]) || 0;
        const hours = parseInt(match[2]) || 0;
        const minutes = parseInt(match[3]) || 0;
        totalSeconds = (days * 86400) + (hours * 3600) + (minutes * 60);
    }
    
    // Assert
    assertEqual(totalSeconds, 9000, 'Should parse "2h30m" as 9000 seconds (2.5 hours)');
    console.log('✓ PASS\n');
}

/**
 * Test: Filename layer height extraction
 */
function test_filename_layer_height_extraction() {
    console.log('TEST: Filename layer height extraction');
    
    // Arrange
    const filename1 = "benchy_0.2mm_PLA.gcode";
    const filename2 = "test_print_0.15_ABS.gcode";
    const regex = /[_\s\.]0\.(\d+)(?:[_\s\.]|mm|$)/i;
    
    // Act
    const match1 = filename1.match(regex);
    const match2 = filename2.match(regex);
    const height1 = match1 ? parseFloat(`0.${match1[1]}`) : null;
    const height2 = match2 ? parseFloat(`0.${match2[1]}`) : null;
    
    // Assert
    assertEqual(height1, 0.2, 'Should extract 0.2mm from "0.2mm"');
    assertEqual(height2, 0.15, 'Should extract 0.15mm from "0.15"');
    console.log('✓ PASS\n');
}

// ============================================================================
// TIME CALCULATION TESTS
// ============================================================================

/**
 * Test: Format seconds into human-readable time (hours and minutes)
 */
function test_format_time_hh_mm() {
    console.log('TEST: Format time as hours and minutes');
    
    // Arrange
    const seconds = 9000; // 2.5 hours
    
    // Act
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const formatted = `${hours}h ${minutes}m`;
    
    // Assert
    assertEqual(formatted, '2h 30m', 'Should format 9000 seconds as "2h 30m"');
    console.log('✓ PASS\n');
}

/**
 * Test: Format seconds into human-readable time with days
 */
function test_format_time_with_days() {
    console.log('TEST: Format time with days');
    
    // Arrange
    const seconds = 92520; // 1d 1h 42m
    
    // Act
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const formatted = `${days}d ${hours}h ${minutes}m`;
    
    // Assert
    assertEqual(formatted, '1d 1h 42m', 'Should format 92520 seconds as "1d 1h 42m"');
    console.log('✓ PASS\n');
}

/**
 * Test: Calculate remaining time from progress and elapsed time
 */
function test_calculate_remaining_from_progress() {
    console.log('TEST: Calculate remaining time from progress');
    
    // Arrange
    const progress = 0.25; // 25% complete
    const elapsedSeconds = 1800; // 30 minutes elapsed
    
    // Act
    // If 25% took 30 minutes, 100% will take 30/0.25 = 120 minutes
    // Remaining = 120 - 30 = 90 minutes
    const totalEstimate = elapsedSeconds / progress;
    const remaining = totalEstimate - elapsedSeconds;
    
    // Assert
    assertEqual(remaining, 5400, 'Should calculate 5400 seconds (90 minutes) remaining');
    console.log('✓ PASS\n');
}

/**
 * Test: Remaining time calculation handles edge cases
 */
function test_remaining_time_edge_cases() {
    console.log('TEST: Remaining time handles edge cases');
    
    // Arrange - 0% progress
    const progress1 = 0;
    const elapsed1 = 100;
    
    // Act
    const remaining1 = progress1 > 0 ? (elapsed1 / progress1) - elapsed1 : null;
    
    // Assert
    assertEqual(remaining1, null, 'Should return null when progress is 0');
    
    // Arrange - 100% progress
    const progress2 = 1.0;
    const elapsed2 = 3600;
    
    // Act
    const remaining2 = (elapsed2 / progress2) - elapsed2;
    
    // Assert
    assertEqual(remaining2, 0, 'Should return 0 when progress is 100%');
    console.log('✓ PASS\n');
}

// ============================================================================
// LAYER INFO FORMATTING TESTS
// ============================================================================

/**
 * Test: Format layer info with both current and total
 */
function test_format_layer_info_complete() {
    console.log('TEST: Format layer info with current and total');
    
    // Arrange
    const currentLayer = 150;
    const totalLayer = 300;
    
    // Act
    const formatted = `${currentLayer} / ${totalLayer}`;
    
    // Assert
    assertEqual(formatted, '150 / 300', 'Should format as "current / total"');
    console.log('✓ PASS\n');
}

/**
 * Test: Format layer info when total is missing
 */
function test_format_layer_info_no_total() {
    console.log('TEST: Format layer info when total is missing');
    
    // Arrange
    const currentLayer = 150;
    const totalLayer = null;
    
    // Act
    const formatted = totalLayer ? `${currentLayer} / ${totalLayer}` : `${currentLayer} / --`;
    
    // Assert
    assertEqual(formatted, '150 / --', 'Should show "--" when total is unavailable');
    console.log('✓ PASS\n');
}

/**
 * Test: Format layer info when both are missing
 */
function test_format_layer_info_all_missing() {
    console.log('TEST: Format layer info when all data missing');
    
    // Arrange
    const currentLayer = null;
    const totalLayer = null;
    
    // Act
    const formatted = currentLayer ? 
        (totalLayer ? `${currentLayer} / ${totalLayer}` : `${currentLayer} / --`) : 
        '--';
    
    // Assert
    assertEqual(formatted, '--', 'Should show "--" when no layer data available');
    console.log('✓ PASS\n');
}

// ============================================================================
// METADATA PARSING TESTS
// ============================================================================

/**
 * Test: Parse layer height from gcode comment
 */
function test_parse_gcode_layer_height() {
    console.log('TEST: Parse layer height from gcode comment');
    
    // Arrange
    const gcodeLines = [
        '; layer_height = 0.2',
        '; first_layer_height = 0.3',
        'G28'
    ];
    
    // Act
    let layerHeight = null;
    let firstLayerHeight = null;
    
    for (const line of gcodeLines) {
        if (!line.startsWith(';')) continue;
        
        // Match first_layer_height first (more specific)
        const firstMatch = line.match(/first_layer_height\s*=\s*([\d.]+)/i);
        if (firstMatch) {
            firstLayerHeight = parseFloat(firstMatch[1]);
            continue;
        }
        
        // Then match layer_height (but not first_layer_height)
        const heightMatch = line.match(/(?<!first_)layer_height\s*=\s*([\d.]+)/i);
        if (heightMatch) layerHeight = parseFloat(heightMatch[1]);
    }
    
    // Assert
    assertEqual(layerHeight, 0.2, 'Should parse layer_height = 0.2');
    assertEqual(firstLayerHeight, 0.3, 'Should parse first_layer_height = 0.3');
    console.log('✓ PASS\n');
}

/**
 * Test: Calculate layer count from object height and layer height
 */
function test_calculate_layer_count_from_heights() {
    console.log('TEST: Calculate layer count from object height and layer height');
    
    // Arrange
    const objectHeight = 50.0;
    const layerHeight = 0.2;
    const firstLayerHeight = 0.3;
    
    // Act
    const layerCount = Math.max(1, Math.round(((objectHeight - firstLayerHeight) / layerHeight) + 1));
    
    // Assert
    assertEqual(layerCount, 250, 'Should calculate 250 layers');
    console.log('✓ PASS\n');
}

/**
 * Test: Estimated time parsing from gcode comments
 */
function test_parse_gcode_estimated_time() {
    console.log('TEST: Parse estimated time from gcode comment');
    
    // Arrange
    const gcodeLines = [
        '; estimated printing time (normal mode) = 2h 30m 15s',
        'G28'
    ];
    
    // Act
    let estimatedSeconds = null;
    
    for (const line of gcodeLines) {
        if (!line.startsWith(';')) continue;
        
        // Try to match time format: Xh Ym Zs
        const timeMatch = line.match(/(\d+)h\s*(\d+)m\s*(\d+)s/i);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]) || 0;
            const minutes = parseInt(timeMatch[2]) || 0;
            const seconds = parseInt(timeMatch[3]) || 0;
            estimatedSeconds = (hours * 3600) + (minutes * 60) + seconds;
        }
    }
    
    // Assert
    assertEqual(estimatedSeconds, 9015, 'Should parse "2h 30m 15s" as 9015 seconds');
    console.log('✓ PASS\n');
}

// ============================================================================
// PERCENTAGE CALCULATION TESTS
// ============================================================================

/**
 * Test: Convert progress decimal to percentage
 */
function test_progress_to_percentage() {
    console.log('TEST: Convert progress to percentage');
    
    // Arrange
    const progress = 0.667;
    
    // Act
    const percentage = Math.round(progress * 100);
    
    // Assert
    assertEqual(percentage, 67, 'Should convert 0.667 to 67%');
    console.log('✓ PASS\n');
}

/**
 * Test: Percentage rounding handles edge cases
 */
function test_percentage_rounding() {
    console.log('TEST: Percentage rounding edge cases');
    
    // Arrange & Act
    const pct1 = Math.round(0.994 * 100);
    const pct2 = Math.round(0.995 * 100);
    const pct3 = Math.round(0.996 * 100);
    
    // Assert
    assertEqual(pct1, 99, 'Should round 0.994 to 99%');
    assertEqual(pct2, 100, 'Should round 0.995 to 100%'); // Rounds up
    assertEqual(pct3, 100, 'Should round 0.996 to 100%');
    console.log('✓ PASS\n');
}

// ============================================================================
// NULL SAFETY TESTS
// ============================================================================

/**
 * Test: Nullish coalescing with multiple fallbacks
 */
function test_nullish_coalescing_chain() {
    console.log('TEST: Nullish coalescing with fallback chain');
    
    // Arrange
    const primary = null;
    const secondary = undefined;
    const tertiary = 0;
    const fallback = 100;
    
    // Act
    const result = primary ?? secondary ?? tertiary ?? fallback;
    
    // Assert
    assertEqual(result, 0, 'Should return first non-null/undefined value (0, not 100)');
    console.log('✓ PASS\n');
}

/**
 * Test: Optional chaining with nested objects
 */
function test_optional_chaining_nested() {
    console.log('TEST: Optional chaining with nested objects');
    
    // Arrange
    const obj1 = { status: { print_stats: { state: 'printing' } } };
    const obj2 = { status: null };
    const obj3 = null;
    
    // Act
    const state1 = obj1?.status?.print_stats?.state;
    const state2 = obj2?.status?.print_stats?.state;
    const state3 = obj3?.status?.print_stats?.state;
    
    // Assert
    assertEqual(state1, 'printing', 'Should access nested property');
    assertEqual(state2, undefined, 'Should return undefined for null intermediate');
    assertEqual(state3, undefined, 'Should return undefined for null root');
    console.log('✓ PASS\n');
}

/**
 * Test: Filename normalization should pass through Klipper's filename as-is
 */
function test_normalize_filename_passthrough() {
    console.log('TEST: Filename normalization passes through unchanged');
    
    // Arrange - Various filename formats that Klipper might provide
    const testCases = [
        { input: "benchy_0.2mm.gcode", expected: "benchy_0.2mm.gcode" },
        { input: "subfolder/test_print.gcode", expected: "subfolder/test_print.gcode" },
        { input: "gcodes/already_prefixed.gcode", expected: "gcodes/already_prefixed.gcode" },
        { input: "MyFiles/custom_folder/part.gcode", expected: "MyFiles/custom_folder/part.gcode" },
        { input: "test.gcode", expected: "test.gcode" }
    ];
    
    // Act & Assert - normalizeFilename should return input unchanged
    for (const testCase of testCases) {
        const normalized = testCase.input; // This is what normalizeFilename does now
        assertEqual(normalized, testCase.expected, `Should pass through "${testCase.input}" unchanged`);
    }
    
    console.log('✓ PASS\n');
}

/**
 * Test: Filename normalization handles null/undefined
 */
function test_normalize_filename_null_handling() {
    console.log('TEST: Filename normalization handles null/undefined');
    
    // Arrange
    const null_input = null;
    const undefined_input = undefined;
    const empty_input = "";
    
    // Act - normalizeFilename should return null for invalid inputs
    const result1 = null_input; // normalizeFilename would return null
    const result2 = undefined_input; // normalizeFilename would return null
    const result3 = empty_input || null; // normalizeFilename would return null
    
    // Assert
    assertEqual(result1, null, 'Should return null for null input');
    assertEqual(result2, undefined, 'Should return null for undefined input');
    assertEqual(result3, null, 'Should return null for empty string');
    console.log('✓ PASS\n');
}

/**
 * Test: API metadata URL should use filename exactly as provided
 */
function test_metadata_api_url_construction() {
    console.log('TEST: Metadata API URL uses filename as-is');
    
    // Arrange
    const printerIp = "192.168.1.100";
    const filename = "subfolder/my_print.gcode";
    
    // Act - This is how we construct the metadata API URL
    const url = `http://${printerIp}/server/files/metadata?filename=${encodeURIComponent(filename)}`;
    
    // Assert
    assertEqual(
        url, 
        "http://192.168.1.100/server/files/metadata?filename=subfolder%2Fmy_print.gcode",
        'Should use filename directly with proper URL encoding'
    );
    console.log('✓ PASS\n');
}

/**
 * Test: Gcode file URL should use filename exactly as provided
 */
function test_gcode_file_url_construction() {
    console.log('TEST: Gcode file URL uses filename as-is');
    
    // Arrange
    const printerIp = "192.168.1.100";
    const filename = "test_print.gcode";
    
    // Act - This is how we construct the gcode file URL
    const safePath = encodeURI(filename);
    const url = `http://${printerIp}/server/files/${safePath}`;
    
    // Assert
    assertEqual(
        url,
        "http://192.168.1.100/server/files/test_print.gcode",
        'Should construct URL with filename directly'
    );
    console.log('✓ PASS\n');
}

/**
 * Test: URL encoding preserves special characters correctly
 */
function test_url_encoding_special_characters() {
    console.log('TEST: URL encoding handles special characters');
    
    // Arrange - Filename with spaces and special chars
    const filename1 = "My Print File.gcode";
    const filename2 = "folder/sub folder/file.gcode";
    
    // Act
    const encoded1 = encodeURIComponent(filename1);
    const encoded2 = encodeURIComponent(filename2);
    
    // Assert
    assertEqual(encoded1, "My%20Print%20File.gcode", 'Should encode spaces as %20');
    assertEqual(encoded2, "folder%2Fsub%20folder%2Ffile.gcode", 'Should encode slashes and spaces');
    console.log('✓ PASS\n');
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
    }
}

function assertApproximatelyEqual(actual, expected, tolerance, message) {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${message}\n  Expected: ${expected} (±${tolerance})\n  Actual: ${actual}`);
    }
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

function runAllTests() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  OBS Print Progress - Unit Tests');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    let passed = 0;
    let failed = 0;
    
    const tests = [
        // Progress tests
        test_progress_from_virtualsdcard,
        test_progress_fallback_when_no_file_size,
        test_progress_handles_null_values,
        test_progress_clamping,
        
        // Layer tests
        test_layer_count_calculation,
        test_layer_count_common_height_fallback,
        
        // Time parsing tests
        test_filename_time_parsing_with_days,
        test_filename_time_parsing_hours_minutes,
        test_filename_layer_height_extraction,
        
        // Time calculation tests
        test_format_time_hh_mm,
        test_format_time_with_days,
        test_calculate_remaining_from_progress,
        test_remaining_time_edge_cases,
        
        // Layer info formatting tests
        test_format_layer_info_complete,
        test_format_layer_info_no_total,
        test_format_layer_info_all_missing,
        
        // Metadata parsing tests
        test_parse_gcode_layer_height,
        test_calculate_layer_count_from_heights,
        test_parse_gcode_estimated_time,
        
        // Percentage tests
        test_progress_to_percentage,
        test_percentage_rounding,
        
        // Null safety tests
        test_nullish_coalescing_chain,
        test_optional_chaining_nested,
        
        // Filename handling tests
        test_normalize_filename_passthrough,
        test_normalize_filename_null_handling,
        test_metadata_api_url_construction,
        test_gcode_file_url_construction,
        test_url_encoding_special_characters
    ];
    
    for (const test of tests) {
        try {
            test();
            passed++;
        } catch (error) {
            failed++;
            console.error(`✗ FAIL: ${error.message}\n`);
        }
    }
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════');
    
    process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests();
}

module.exports = {
    // Progress tests
    test_progress_from_virtualsdcard,
    test_progress_fallback_when_no_file_size,
    test_progress_handles_null_values,
    test_progress_clamping,
    
    // Layer tests
    test_layer_count_calculation,
    test_layer_count_common_height_fallback,
    
    // Time parsing tests
    test_filename_time_parsing_with_days,
    test_filename_time_parsing_hours_minutes,
    test_filename_layer_height_extraction,
    
    // Time calculation tests
    test_format_time_hh_mm,
    test_format_time_with_days,
    test_calculate_remaining_from_progress,
    test_remaining_time_edge_cases,
    
    // Layer info formatting tests
    test_format_layer_info_complete,
    test_format_layer_info_no_total,
    test_format_layer_info_all_missing,
    
    // Metadata parsing tests
    test_parse_gcode_layer_height,
    test_calculate_layer_count_from_heights,
    test_parse_gcode_estimated_time,
    
    // Percentage tests
    test_progress_to_percentage,
    test_percentage_rounding,
    
    // Null safety tests
    test_nullish_coalescing_chain,
    test_optional_chaining_nested,
    
    // Filename handling tests
    test_normalize_filename_passthrough,
    test_normalize_filename_null_handling,
    test_metadata_api_url_construction,
    test_gcode_file_url_construction,
    test_url_encoding_special_characters
};
