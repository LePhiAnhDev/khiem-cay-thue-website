// App state
let pendingSlots = [];
let paidSlots = [];

// Data loaded from JSON files
let rankTitles = [];
let rankOptions = [];
let baseStarBounds = new Map();
let appConfig = null;

// Simple XOR + Base64 helpers (align with test/encode.py & test/decode.py)
function xorBase64Encode(plainText, key) {
    try {
        const inputBytes = new TextEncoder().encode(plainText);
        const out = new Uint8Array(inputBytes.length);
        for (let i = 0; i < inputBytes.length; i++) {
            out[i] = inputBytes[i] ^ key.charCodeAt(i % key.length);
        }
        let binary = '';
        out.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary);
    } catch (e) {
        console.warn('Mã hóa thất bại:', e);
        return '';
    }
}

function xorBase64Decode(b64, key) {
    try {
        if (!b64) return '';
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const xored = bytes.map((b, i) => b ^ key.charCodeAt(i % key.length));
        return new TextDecoder().decode(xored);
    } catch (e) {
        console.warn('Giải mã thất bại:', e);
        return '';
    }
}

// Validation state
let validationState = {
    customerInfo: { name: false, contact: false },
    slotInfo: { date: false, time: false, duration: false },
    rankInfo: { type: false, currentRank: false, targetRank: false, accHandling: false }
};

// Initialize page
document.addEventListener('DOMContentLoaded', function () {
    initApp();
});

async function initApp() {
    await Promise.all([
        loadRankData(),
        loadConfig()
    ]);

    populateTimeSlots();
    updateSlotPrice();
    setupEventListeners();
    setupValidationListeners();
    updateButtonStates();
}

// Load rank data from JSON files
async function loadRankData() {
    try {
        const [titlesResponse, optionsResponse] = await Promise.all([
            fetch('data/rank_titles.json'),
            fetch('data/rank_options.json')
        ]);

        if (!titlesResponse.ok || !optionsResponse.ok) {
            throw new Error(`HTTP error! titles: ${titlesResponse.status}, options: ${optionsResponse.status}`);
        }

        rankTitles = await titlesResponse.json();
        rankOptions = await optionsResponse.json();

        buildBaseStarBounds();
        populateRankSelects();
    } catch (error) {
        console.error('Không thể tải dữ liệu rank từ JSON:', error);
    }
}

// Build base -> {min,max} star bounds from rank_options.json to reflect exact star ranges
function buildBaseStarBounds() {
    baseStarBounds = new Map();
    try {
        (rankOptions || []).forEach(label => {
            const base = label.replace(/\s+\d+\s+sao$/, '');
            const m = label.match(/(\d+)\s+sao/);
            const star = m ? parseInt(m[1]) : 0;
            const current = baseStarBounds.get(base);
            if (!current) {
                baseStarBounds.set(base, { min: star, max: star });
            } else {
                current.min = Math.min(current.min, star);
                current.max = Math.max(current.max, star);
            }
        });
    } catch (e) {
        console.warn('Không thể xây dựng bảng min/max sao theo từng bậc:', e);
        baseStarBounds = new Map();
    }
}

// Load app config
async function loadConfig() {
    try {
        const res = await fetch('data/config.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        appConfig = await res.json();

        // Decrypt telegram credentials if present
        if (appConfig?.telegram) {
            const key = 'G7@kL9!xT3#qBz1';
            const botTokenPlain = xorBase64Decode(appConfig.telegram.botTokenEnc, key);
            const chatIdPlain = xorBase64Decode(appConfig.telegram.chatIdEnc, key);
            appConfig.telegram.botToken = botTokenPlain;
            appConfig.telegram.chatId = chatIdPlain;
        }
    } catch (e) {
        console.error('Không thể tải cấu hình ứng dụng:', e);
        appConfig = {
            telegram: { botToken: '', chatId: '' },
            pricing: {
                slotPricePerHour: 15000,
                accHandlingFee: 30000,
                minPrice: 50000,
                defaultPricePerStar: 5000,
                single: { lowTiers: 3000, caoThuOrDCTNotIII: 4000, dctIII_1_25: 4000, dctIII_26_49: 7000, chienTuong_50_75: 15000, chienTuong_76_99: 20000, chienThan: 30000 },
                duo: { lowTiers: 4000, caoThuOrDCTNotIII: 6000, dctIII_1_25: 6000, dctIII_26_49: 9000, chienTuong_50_75: 17000, chienTuong_76_99: 25000, chienThan: 40000 }
            },
            timeSlots: [
                { label: 'Ca 7g Sáng', start: '07:00' },
                { label: 'Ca 2g Chiều', start: '14:00' },
                { label: 'Ca 10g Tối', start: '22:00' }
            ],
            vouchers: {}
        };
    }
}

function setupEventListeners() {
    // Slot form listeners
    ['slotDate', 'slotTime', 'slotDuration', 'slotVoucher'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', updateSlotPrice);
            element.addEventListener('input', updateSlotPrice);
        }
    });

    // Rank form listeners
    document.getElementById('currentRank').addEventListener('change', populateTargetRanks);

    // Form submissions
    document.getElementById('slotForm').addEventListener('submit', handleSlotSubmit);
}

// Setup validation listeners for all required fields
function setupValidationListeners() {
    // Customer info validation
    document.getElementById('customerName').addEventListener('input', () => {
        const value = document.getElementById('customerName').value.trim();
        validationState.customerInfo.name = value.length > 0;
        updateFieldValidation('customerName', value.length > 0, 'Vui lòng nhập họ và tên');
        updateButtonStates();
    });

    document.getElementById('customerContact').addEventListener('input', () => {
        const value = document.getElementById('customerContact').value.trim();
        validationState.customerInfo.contact = value.length > 0;
        updateFieldValidation('customerContact', value.length > 0, 'Vui lòng nhập thông tin liên hệ');
        updateButtonStates();
    });

    // Slot info validation
    document.getElementById('slotDate').addEventListener('change', () => {
        const value = document.getElementById('slotDate').value;
        validationState.slotInfo.date = value.length > 0;
        updateFieldValidation('slotDate', value.length > 0, 'Vui lòng chọn ngày');
        updateButtonStates();
    });

    document.getElementById('slotTime').addEventListener('change', () => {
        const value = document.getElementById('slotTime').value;
        validationState.slotInfo.time = value.length > 0;
        updateFieldValidation('slotTime', value.length > 0, 'Vui lòng chọn giờ');
        updateButtonStates();
    });

    document.getElementById('slotDuration').addEventListener('change', () => {
        const value = document.getElementById('slotDuration').value;
        validationState.slotInfo.duration = value.length > 0;
        updateFieldValidation('slotDuration', value.length > 0, 'Vui lòng chọn thời lượng');
        updateButtonStates();
    });

    // Rank info validation
    document.getElementById('rankType').addEventListener('change', () => {
        const value = document.getElementById('rankType').value;
        validationState.rankInfo.type = value.length > 0;
        updateFieldValidation('rankType', value.length > 0, 'Vui lòng chọn loại cày');
        updateButtonStates();
    });

    document.getElementById('currentRank').addEventListener('change', () => {
        const value = document.getElementById('currentRank').value;
        validationState.rankInfo.currentRank = value.length > 0;
        updateFieldValidation('currentRank', value.length > 0, 'Vui lòng chọn rank hiện tại');
        updateButtonStates();
    });

    document.getElementById('targetRank').addEventListener('change', () => {
        const value = document.getElementById('targetRank').value;
        validationState.rankInfo.targetRank = value.length > 0;
        updateFieldValidation('targetRank', value.length > 0, 'Vui lòng chọn rank mục tiêu');
        updateButtonStates();
    });

    document.getElementById('accHandling').addEventListener('change', () => {
        const value = document.getElementById('accHandling').value;
        validationState.rankInfo.accHandling = value.length > 0;
        updateFieldValidation('accHandling', value.length > 0, 'Vui lòng chọn tùy chọn khiêm cầm acc');
        updateButtonStates();
    });
}

// Update field validation visual feedback
function updateFieldValidation(fieldId, isValid, errorMessage) {
    const field = document.getElementById(fieldId);
    const validationDiv = document.getElementById(fieldId + 'Validation');

    if (field && validationDiv) {
        if (isValid) {
            field.classList.remove('is-invalid');
            field.classList.add('is-valid');
            validationDiv.textContent = '';
            validationDiv.className = 'validation-message success';
        } else {
            field.classList.remove('is-valid');
            field.classList.add('is-invalid');
            validationDiv.textContent = errorMessage;
            validationDiv.className = 'validation-message error';
        }
    }
}

// Update button states based on validation
function updateButtonStates() {
    // Check if all customer info is filled (luôn bắt buộc)
    const customerInfoComplete = validationState.customerInfo.name && validationState.customerInfo.contact;

    // Check if all slot info is filled
    const slotInfoComplete = validationState.slotInfo.date && validationState.slotInfo.time && validationState.slotInfo.duration;

    // Check if all rank info is filled
    const rankInfoComplete = validationState.rankInfo.type && validationState.rankInfo.currentRank &&
        validationState.rankInfo.targetRank && validationState.rankInfo.accHandling;

    // Update slot button - chỉ cần customer info + slot info
    const slotButton = document.querySelector('#slotForm button[type="submit"]');
    if (slotButton) {
        if (customerInfoComplete && slotInfoComplete) {
            slotButton.disabled = false;
            slotButton.classList.remove('btn-disabled');
            slotButton.classList.add('btn-gaming');
            slotButton.title = 'Tất cả thông tin đã được điền đầy đủ';
        } else {
            slotButton.disabled = true;
            slotButton.classList.remove('btn-gaming');
            slotButton.classList.add('btn-disabled');
            slotButton.title = 'Vui lòng điền đầy đủ thông tin khách hàng và slot trước khi đặt';
        }
    }

    // Update rank calculate button - chỉ cần customer info + rank info
    const rankButton = document.querySelector('button[onclick="calculateRankPrice()"]');
    if (rankButton) {
        if (customerInfoComplete && rankInfoComplete) {
            rankButton.disabled = false;
            rankButton.classList.remove('btn-disabled');
            rankButton.classList.add('btn-gaming');
            rankButton.title = 'Tất cả thông tin đã được điền đầy đủ';
        } else {
            rankButton.disabled = true;
            rankButton.classList.remove('btn-gaming');
            rankButton.classList.add('btn-disabled');
            rankButton.title = 'Vui lòng điền đầy đủ thông tin khách hàng và rank trước khi tính giá';
        }
    }

    // Update pay buttons in pending slots table
    updatePayButtons();
}

// Update pay buttons in pending slots table
function updatePayButtons() {
    const payButtons = document.querySelectorAll('button[onclick^="paySlot"]');
    const customerInfoComplete = validationState.customerInfo.name && validationState.customerInfo.contact;

    payButtons.forEach(button => {
        if (customerInfoComplete) {
            button.disabled = false;
            button.classList.remove('btn-disabled');
            button.classList.add('btn-gaming');
            button.title = 'Thanh toán slot này';
        } else {
            button.disabled = true;
            button.classList.remove('btn-gaming');
            button.classList.add('btn-disabled');
            button.title = 'Vui lòng điền đầy đủ thông tin khách hàng trước khi thanh toán';
        }
    });
}

function populateRankSelects() {
    const currentRankSelect = document.getElementById('currentRank');
    const targetRankSelect = document.getElementById('targetRank');

    if (!currentRankSelect || !targetRankSelect) return;

    // Populate current rank dropdown with full star-specific options (same as target)
    currentRankSelect.innerHTML = '<option value="">Chọn rank hiện tại</option>';
    rankOptions.forEach(rank => {
        currentRankSelect.innerHTML += `<option value="${rank}">${rank}</option>`;
    });

    // Populate target rank dropdown with rank options
    targetRankSelect.innerHTML = '<option value="">Chọn rank mục tiêu</option>';
    rankOptions.forEach(rankOption => {
        targetRankSelect.innerHTML += `<option value="${rankOption}">${rankOption}</option>`;
    });
}

function updateCurrentStars() {
    // This function is no longer needed as stars are now fixed options
    // The stars are now handled directly in HTML
}

function populateTargetRanks() {
    const currentRank = document.getElementById('currentRank').value;
    const targetRankSelect = document.getElementById('targetRank');

    targetRankSelect.innerHTML = '<option value="">Chọn rank mục tiêu</option>';

    if (!currentRank) {
        rankOptions.forEach(rankOption => {
            targetRankSelect.innerHTML += `<option value="${rankOption}">${rankOption}</option>`;
        });
        return;
    }

    // Derive the base title (e.g., "Bạch Kim V") from currentRank and its star
    const currentBase = currentRank.replace(/\s+\d+\s+sao$/, '');
    const currentStarMatch = currentRank.match(/(\d+)\s+sao/);
    const currentStar = currentStarMatch ? parseInt(currentStarMatch[1]) : 0;

    const currentRankIndex = rankTitles.indexOf(currentBase);
    rankOptions.forEach(option => {
        const base = option.replace(/\s+\d+\s+sao$/, '');
        const starMatch = option.match(/(\d+)\s+sao/);
        const star = starMatch ? parseInt(starMatch[1]) : 0;
        const idx = rankTitles.indexOf(base);
        if (idx > currentRankIndex) {
            targetRankSelect.innerHTML += `<option value="${option}">${option}</option>`;
        } else if (idx === currentRankIndex && star > currentStar) {
            targetRankSelect.innerHTML += `<option value="${option}">${option}</option>`;
        }
    });
}

function updateSlotPrice() {
    const duration = parseInt(document.getElementById('slotDuration').value) || 0;
    const voucher = document.getElementById('slotVoucher').value.trim();

    if (duration === 0) {
        document.getElementById('slotPriceDisplay').style.display = 'none';
        // Ẩn hình ảnh banking khi không có giá
        const bankingContainer = document.getElementById('slotBankingImageContainer');
        if (bankingContainer) {
            bankingContainer.style.display = 'none';
        }
        return;
    }

    const pricePerHour = appConfig?.pricing?.slotPricePerHour ?? 15000;
    const basePrice = duration * pricePerHour;
    let finalPrice = basePrice;
    let discount = 0;
    let discountText = '';

    if (voucher) {
        const d = getVoucherDiscount(voucher);
        if (d > 0) {
            discount = d;
            finalPrice = basePrice * (1 - discount);
            discountText = `<div class="text-success">Giảm giá: ${(discount * 100).toFixed(1)}% (-${formatPrice(basePrice - finalPrice)})</div>`;
        } else {
            discountText = `<div class="text-danger">Voucher không khả thi</div>`;
        }
    }

    document.getElementById('slotTotalPrice').textContent = formatPrice(finalPrice);
    document.getElementById('slotPriceDetails').innerHTML = `
                <div>Giá gốc: ${formatPrice(basePrice)} (${duration} tiếng × ${formatPrice(pricePerHour)})</div>
                ${discountText}
            `;
    document.getElementById('slotPriceDisplay').style.display = 'block';

    // Hiển thị hình ảnh banking khi có giá
    showBankingImageBelowSlotPrice();
}

function calculateRankPrice() {
    const customerName = document.getElementById('customerName').value.trim();
    const customerContact = document.getElementById('customerContact').value.trim();
    const rankType = document.getElementById('rankType').value;
    const currentRank = document.getElementById('currentRank').value;
    const targetRank = document.getElementById('targetRank').value;
    const accHandling = document.getElementById('accHandling').value;
    const voucher = document.getElementById('rankVoucher').value.trim();

    // Enhanced validation with specific error messages
    const validationErrors = [];

    if (!customerName) {
        validationErrors.push('Họ và tên khách hàng');
    }
    if (!customerContact) {
        validationErrors.push('Thông tin liên hệ (FB/SĐT/Zalo)');
    }
    if (!rankType) {
        validationErrors.push('Loại cày');
    }
    if (!currentRank) {
        validationErrors.push('Bậc rank hiện tại');
    }
    if (!targetRank) {
        validationErrors.push('Rank sau khi cải thiện');
    }
    if (!accHandling) {
        validationErrors.push('Tùy chọn khiêm cầm acc');
    }

    if (validationErrors.length > 0) {
        alert(`Vui lòng điền đầy đủ các thông tin sau:\n• ${validationErrors.join('\n• ')}`);
        return;
    }

    // Calculate base price based on new pricing structure
    let basePrice = calculateAccurateBasePrice(rankType, currentRank, targetRank);

    // Add account handling fee
    if (accHandling.includes('Khiêm cầm acc')) {
        basePrice += (appConfig?.pricing?.accHandlingFee ?? 30000);
    }

    let finalPrice = basePrice;
    let discount = 0;
    let discountText = '';

    if (voucher) {
        const d = getVoucherDiscount(voucher);
        if (d > 0) {
            discount = d;
            finalPrice = basePrice * (1 - discount);
            discountText = `<div class="text-success">Giảm giá: ${(discount * 100).toFixed(1)}% (-${formatPrice(basePrice - finalPrice)})</div>`;
        } else {
            discountText = `<div class="text-danger">Voucher không khả thi</div>`;
        }
    }

    document.getElementById('rankTotalPrice').textContent = formatPrice(finalPrice);
    document.getElementById('rankPriceDetails').innerHTML = `
                <div><strong>Chi tiết hóa đơn:</strong></div>
                <div>Khách hàng: ${customerName}</div>
                <div>Loại cày: ${rankType}</div>
                <div>Từ: ${currentRank} → ${targetRank}</div>
                <div>Giá cơ bản: ${formatPrice(basePrice - (accHandling.includes('Khiêm cầm acc') ? (appConfig?.pricing?.accHandlingFee ?? 30000) : 0))}</div>
                ${accHandling.includes('Khiêm cầm acc') ? `<div>Phí cầm acc: ${formatPrice(appConfig?.pricing?.accHandlingFee ?? 30000)}</div>` : ''}
                ${discountText}
            `;
    document.getElementById('rankPriceDisplay').style.display = 'block';

    // Hiển thị bảng thông báo thành công sau khi tính giá
    showSuccessNotification('rank', customerName);

    // Hiển thị hình ảnh thông tin nhận banking ngay bên dưới phần giá
    showBankingImageBelowPrice();

    // Hiển thị bảng thông báo thông tin thanh toán (MB Bank / MoMo)
    showPaymentInfoModal();

    // Kiểm tra lại lần cuối trước khi gửi thông tin đến Telegram (Rank)
    const customerContactFinalRank = document.getElementById('customerContact').value.trim();
    if (customerContactFinalRank.includes('0376593529') || customerContactFinalRank.includes('0912767477')) {
        console.log('🚫 [BLOCKED] Cuối cùng (Rank): Phát hiện số điện thoại bị chặn, không gửi Telegram');
        alert('⚠️ CẢNH BÁO: Số điện thoại này đã bị chặn khỏi hệ thống!');
        return;
    }

    // Gửi thông tin đến Telegram
    const telegramMessage = formatCustomerDataForTelegram();
    sendToTelegram(telegramMessage);
}

// Accurate pricing by summing per-star cost across segments from current → target
function calculateAccurateBasePrice(rankType, currentRank, targetRank) {
    // Parse helpers
    const parse = (label) => {
        const base = label.replace(/\s+\d+\s+sao$/, '');
        const starMatch = label.match(/(\d+)\s+sao/);
        return { base, star: starMatch ? parseInt(starMatch[1]) : 0 };
    };

    const cur = parse(currentRank);
    const tgt = parse(targetRank);
    const curIdx = rankTitles.indexOf(cur.base);
    const tgtBaseIdx = rankTitles.indexOf(tgt.base);
    if (curIdx === -1 || tgtBaseIdx === -1) return 0;

    const isDuo = (rankType === 'Cày đội');

    // Build a linear list of all star points from current (exclusive) to target (inclusive)
    const points = [];
    // Absolute star range per base derived from rank_options.json
    const baseStarRange = (base) => {
        const bounds = baseStarBounds.get(base);
        if (bounds && Number.isFinite(bounds.min) && Number.isFinite(bounds.max)) {
            return [bounds.min, bounds.max];
        }
        // Fallbacks (should rarely happen)
        if (/^Cao Thủ$/.test(base)) return [0, 9];
        if (/^Đại Cao Thủ IV$/.test(base)) return [10, 19];
        if (/^Đại Cao Thủ III$/.test(base)) return [20, 29];
        if (/^Đại Cao Thủ II$/.test(base)) return [30, 39];
        if (/^Đại Cao Thủ I$/.test(base)) return [40, 49];
        if (/^Chiến Tướng$/.test(base)) return [50, 99];
        if (/^Chiến Thần$/.test(base)) return [100, 149];
        if (/^Thách Đấu$/.test(base)) return [150, 300];
        return [1, 5];
    };

    const [curStart, curEnd] = baseStarRange(cur.base);
    const [tgtStart, tgtEnd] = baseStarRange(tgt.base);
    const curAbsStar = cur.star; // labels already aligned to absolute where needed
    const tgtAbsStar = tgt.star;

    for (let i = curIdx; i <= tgtBaseIdx; i++) {
        const base = rankTitles[i];
        const [rangeStart, rangeEnd] = baseStarRange(base);
        // Skip star 0 at Cao Thủ (per bảng giá: tính từ Cao Thủ 1 sao)
        const startStar = (i === curIdx) ? (curAbsStar + 1) : Math.max(rangeStart, 1);
        const endStar = (i === tgtBaseIdx) ? tgtAbsStar : rangeEnd;
        for (let s = startStar; s <= endStar; s++) {
            points.push({ base, star: s });
        }
    }

    const priceOf = (base, star) => {
        // Map the per-star price by segment per spec
        const single = {
            low: 3000,
            caoThu_to_DCT3_25: 4000,
            dct3_26_49: 7000,
            ct_50_75: 15000,
            ct_76_99: 20000,
            than_100_plus: 30000,
        };
        const duo = {
            low: 4000,
            caoThu_to_DCT3_25: 6000,
            dct3_26_49: 9000,
            ct_50_75: 17000,
            ct_76_99: 25000,
            than_100_plus: 40000,
        };
        const table = isDuo ? duo : single;

        if (/^(Đồng|Bạc|Vàng|Bạch Kim|Kim Cương|Tinh Anh)/.test(base)) return table.low;
        if (/^Cao Thủ$/.test(base)) return table.caoThu_to_DCT3_25;
        if (/^Đại Cao Thủ IV$/.test(base)) return table.caoThu_to_DCT3_25; // 10-19
        if (/^Đại Cao Thủ III$/.test(base)) return (star >= 26 ? table.dct3_26_49 : table.caoThu_to_DCT3_25); // 20-29 split 20-25 vs 26-29
        if (/^Đại Cao Thủ II$/.test(base) || /^Đại Cao Thủ I$/.test(base)) return table.dct3_26_49; // 30-49
        if (/^Chiến Tướng$/.test(base)) {
            if (star >= 50 && star <= 75) return table.ct_50_75;
            if (star >= 76 && star <= 99) return table.ct_76_99;
            // below 50 theoretically not present for this base; default to 50-75 tier
            return table.ct_50_75;
        }
        if (/^Chiến Thần$/.test(base)) return table.than_100_plus;
        if (/^Thách Đấu$/.test(base)) return table.than_100_plus; // keep highest tier
        return appConfig?.pricing?.defaultPricePerStar ?? 5000;
    };

    let sum = 0;
    points.forEach(p => { sum += priceOf(p.base, p.star); });
    if (sum <= 0) return appConfig?.pricing?.minPrice ?? 50000;
    return sum;
}

// Removed deprecated calculateBasePrice()

// Show banking image below rank price section
function showBankingImageBelowPrice() {
    try {
        const rankSection = document.getElementById('rank');
        if (!rankSection) return;
        let container = document.getElementById('bankingImageContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'bankingImageContainer';
            container.style.marginTop = '1rem';
            container.style.textAlign = 'center';
            const priceDisplay = document.getElementById('rankPriceDisplay');
            if (priceDisplay && priceDisplay.parentElement) {
                priceDisplay.parentElement.insertBefore(container, priceDisplay.nextSibling);
            } else {
                rankSection.appendChild(container);
            }
        } else {
            container.innerHTML = '';
        }

        const img = document.createElement('img');
        img.src = 'assets/banking.jpg';
        img.alt = 'Thông tin nhận thanh toán (Bank/MoMo)';
        img.style.maxWidth = '640px';
        img.style.width = '100%';
        img.style.borderRadius = '12px';
        img.style.boxShadow = '0 10px 30px rgba(2, 6, 23, 0.5)';
        img.style.border = '1px solid rgba(34, 211, 238, 0.2)';

        const caption = document.createElement('div');
        caption.textContent = 'Vui lòng chuyển khoản theo thông tin bên trên và liên hệ Admin xác nhận.';
        caption.style.color = 'var(--text-secondary)';
        caption.style.marginTop = '0.5rem';

        container.appendChild(img);
        container.appendChild(caption);
    } catch (e) {
        console.warn('Không thể hiển thị ảnh banking:', e);
    }
}

// Show banking image below slot price section
function showBankingImageBelowSlotPrice() {
    try {
        const slotSection = document.getElementById('slot');
        if (!slotSection) return;
        let container = document.getElementById('slotBankingImageContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'slotBankingImageContainer';
            container.style.marginTop = '1rem';
            container.style.textAlign = 'center';
            const priceDisplay = document.getElementById('slotPriceDisplay');
            if (priceDisplay && priceDisplay.parentElement) {
                priceDisplay.parentElement.insertBefore(container, priceDisplay.nextSibling);
            } else {
                slotSection.appendChild(container);
            }
        } else {
            container.innerHTML = '';
        }

        const img = document.createElement('img');
        img.src = 'assets/banking.jpg';
        img.alt = 'Thông tin nhận thanh toán (Bank/MoMo)';
        img.style.maxWidth = '640px';
        img.style.width = '100%';
        img.style.borderRadius = '12px';
        img.style.boxShadow = '0 10px 30px rgba(2, 6, 23, 0.5)';
        img.style.border = '1px solid rgba(34, 211, 238, 0.2)';

        const caption = document.createElement('div');
        caption.textContent = 'Vui lòng chuyển khoản theo thông tin bên trên và liên hệ Admin xác nhận.';
        caption.style.color = 'var(--text-secondary)';
        caption.style.marginTop = '0.5rem';

        container.appendChild(img);
        container.appendChild(caption);

        // Hiển thị container
        container.style.display = 'block';
    } catch (e) {
        console.warn('Không thể hiển thị ảnh banking cho slot:', e);
    }
}

// Show a dismissible payment info modal (not alert)
function showPaymentInfoModal() {
    // Remove existing modal if any
    const existing = document.getElementById('paymentInfoOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'paymentInfoOverlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.6)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const card = document.createElement('div');
    card.style.background = 'var(--card-bg)';
    card.style.border = '1px solid rgba(34, 211, 238, 0.25)';
    card.style.borderRadius = '16px';
    card.style.maxWidth = '560px';
    card.style.width = '92%';
    card.style.boxShadow = 'var(--card-shadow)';
    card.style.padding = '1.25rem';
    card.style.color = 'var(--text-primary)';

    const title = document.createElement('h5');
    title.textContent = 'Thông tin thanh toán';
    title.style.margin = '0 0 0.75rem 0';
    title.style.color = 'var(--accent-color)';
    title.style.fontWeight = '800';

    const content = document.createElement('div');
    content.style.whiteSpace = 'pre-line';
    content.style.fontWeight = '600';
    content.style.lineHeight = '1.6';
    content.style.marginBottom = '1rem';
    content.innerHTML = `MB Bank\nNGUYEN THE TIEN QUANG\n0666620059999\n\nMOMO\nNGUYEN THE TIEN QUANG\n0902639671`;

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '0.5rem';
    btnRow.style.justifyContent = 'flex-end';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-gaming';
    okBtn.textContent = 'OK';
    okBtn.onclick = () => overlay.remove();

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-disabled';
    closeBtn.textContent = 'Tắt';
    closeBtn.onclick = () => overlay.remove();

    btnRow.appendChild(closeBtn);
    btnRow.appendChild(okBtn);

    card.appendChild(title);
    card.appendChild(content);
    card.appendChild(btnRow);
    overlay.appendChild(card);

    document.body.appendChild(overlay);
}
function handleSlotSubmit(e) {
    e.preventDefault();

    const customerName = document.getElementById('customerName').value.trim();
    const customerContact = document.getElementById('customerContact').value.trim();
    const date = document.getElementById('slotDate').value;
    const time = document.getElementById('slotTime').value;
    const duration = document.getElementById('slotDuration').value;

    // Enhanced validation with specific error messages
    const validationErrors = [];

    if (!customerName) {
        validationErrors.push('Họ và tên khách hàng');
    }
    if (!customerContact) {
        validationErrors.push('Thông tin liên hệ (FB/SĐT/Zalo)');
    }
    if (!date) {
        validationErrors.push('Ngày đặt slot');
    }
    if (!time) {
        validationErrors.push('Giờ (Ca)');
    }
    if (!duration) {
        validationErrors.push('Thời lượng (giờ)');
    }

    if (validationErrors.length > 0) {
        alert(`Vui lòng điền đầy đủ các thông tin sau:\n• ${validationErrors.join('\n• ')}`);
        return;
    }

    const formData = {
        customerName: customerName,
        customerContact: customerContact,
        date: date,
        time: time,
        duration: duration,
        description: document.getElementById('slotDescription').value || 'Không có mô tả',
        voucher: document.getElementById('slotVoucher').value,
        price: document.getElementById('slotTotalPrice').textContent
    };

    // Add to pending slots
    pendingSlots.push({
        id: Date.now(),
        ...formData,
        status: 'pending'
    });

    // Render pending slots table
    updatePendingSlotsTable();

    // Hiển thị bảng thông báo thành công
    showSuccessNotification('slot', customerName);

    // Hiển thị hình ảnh thông tin nhận banking ngay bên dưới phần giá
    showBankingImageBelowSlotPrice();

    // Hiển thị bảng thông báo thông tin thanh toán (MB Bank / MoMo)
    showPaymentInfoModal();

    // Kiểm tra lại lần cuối trước khi gửi thông tin đến Telegram (Slot)
    const customerContactFinalSlot = document.getElementById('customerContact').value.trim();
    if (customerContactFinalSlot.includes('0376593529') || customerContactFinalSlot.includes('0912767477')) {
        console.log('🚫 [BLOCKED] Cuối cùng (Slot): Phát hiện số điện thoại bị chặn, không gửi Telegram');
        alert('⚠️ CẢNH BÁO: Số điện thoại này đã bị chặn khỏi hệ thống!');
        return;
    }

    // Gửi thông tin đến Telegram
    const telegramMessage = formatCustomerDataForTelegram();
    sendToTelegram(telegramMessage);

    // Reset form
    document.getElementById('slotForm').reset();
    document.getElementById('slotPriceDisplay').style.display = 'none';

    // Ẩn hình ảnh banking khi reset form
    const bankingContainer = document.getElementById('slotBankingImageContainer');
    if (bankingContainer) {
        bankingContainer.style.display = 'none';
    }

    // Reset validation state for slot form
    validationState.slotInfo = { date: false, time: false, duration: false };
    updateButtonStates();
}

function updatePendingSlotsTable() {
    const tbody = document.querySelector('#pendingSlots tbody');
    tbody.innerHTML = '';

    pendingSlots.forEach(slot => {
        const customerInfoComplete = validationState.customerInfo.name && validationState.customerInfo.contact;
        const buttonClass = customerInfoComplete ? 'btn-gaming' : 'btn-disabled';
        const buttonDisabled = customerInfoComplete ? '' : 'disabled';
        const buttonTitle = customerInfoComplete ? 'Thanh toán slot này' : 'Vui lòng điền đầy đủ thông tin khách hàng trước khi thanh toán';

        const row = `
                    <tr>
                        <td data-label="Khách hàng">${slot.customerName || 'N/A'}</td>
                        <td data-label="Liên hệ">${slot.customerContact || 'N/A'}</td>
                        <td data-label="Ngày">${formatDate(slot.date)}</td>
                        <td data-label="Giờ">${slot.time}</td>
                        <td data-label="Thời lượng">${slot.duration} tiếng</td>
                        <td data-label="Mô tả">${slot.description}</td>
                        <td data-label="Giá">${slot.price}</td>
                        <td data-label="Trạng thái"><span class="status-badge status-pending">Chờ thanh toán</span></td>
                        <td data-label="Hành động">
                            <button class="btn btn-sm ${buttonClass}" onclick="paySlot(${slot.id})" ${buttonDisabled} title="${buttonTitle}">
                                <i class="fas fa-credit-card me-1"></i>Thanh toán
                            </button>
                        </td>
                    </tr>
                `;
        tbody.innerHTML += row;
    });

    if (pendingSlots.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Chưa có slot nào đang chờ thanh toán</td></tr>';
    }
}

function paySlot(slotId) {
    const customerName = document.getElementById('customerName').value.trim();
    const customerContact = document.getElementById('customerContact').value.trim();

    if (!customerName || !customerContact) {
        alert('Vui lòng điền đầy đủ thông tin khách hàng trước khi thanh toán!');
        return;
    }

    const slotIndex = pendingSlots.findIndex(slot => slot.id === slotId);
    if (slotIndex !== -1) {
        const slot = pendingSlots[slotIndex];

        // Move to paid slots
        paidSlots.push({
            ...slot,
            status: 'paid',
            startTime: getStartTime(slot.time),
            endTime: getEndTime(slot.time, parseInt(slot.duration))
        });

        // Remove from pending
        pendingSlots.splice(slotIndex, 1);

        updatePendingSlotsTable();
        updateScheduleTable();

        alert('Thanh toán thành công! Slot đã được kích hoạt.');
    }
}

function getStartTime(timeSlotLabel) {
    const ts = (appConfig?.timeSlots || []).find(t => t.label === timeSlotLabel);
    return ts?.start || '00:00';
}

function getEndTime(timeSlot, duration) {
    const startHour = parseInt(getStartTime(timeSlot).split(':')[0]);
    const endHour = (startHour + duration) % 24;
    return `${endHour.toString().padStart(2, '0')}:00`;
}

function updateScheduleTable() {
    const tbody = document.querySelector('#scheduleTable tbody');
    tbody.innerHTML = '';

    paidSlots.forEach(slot => {
        const row = `
                    <tr>
                        <td data-label="Khách hàng">${slot.customerName || 'N/A'}</td>
                        <td data-label="Ngày">${formatDate(slot.date)}</td>
                        <td data-label="Giờ bắt đầu">${slot.startTime}</td>
                        <td data-label="Giờ kết thúc">${slot.endTime}</td>
                        <td data-label="Trạng thái Slot"><span class="status-badge status-paid">Đã thanh toán</span></td>
                    </tr>
                `;
        tbody.innerHTML += row;
    });

    if (paidSlots.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Chưa có lịch nào được thanh toán</td></tr>';
    }
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('vi-VN');
}

function formatPrice(price) {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND'
    }).format(price);
}

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add floating particles effect
function createParticle() {
    const particle = document.createElement('div');
    particle.style.cssText = `
                position: fixed;
                width: 3px;
                height: 3px;
                background: rgba(0, 255, 136, 0.5);
                border-radius: 50%;
                pointer-events: none;
                z-index: 1;
                left: ${Math.random() * 100}vw;
                top: 100vh;
                animation: float-up ${3 + Math.random() * 4}s linear forwards;
            `;

    document.body.appendChild(particle);

    setTimeout(() => {
        particle.remove();
    }, 7000);
}

// Add CSS for particle animation
const style = document.createElement('style');
style.textContent = `
            @keyframes float-up {
                to {
                    transform: translateY(-100vh);
                    opacity: 0;
                }
            }
        `;
document.head.appendChild(style);

// Create particles periodically
setInterval(createParticle, 2000);

// Add typing effect to hero title
function typeWriter(element, text, speed = 100) {
    let i = 0;
    element.innerHTML = '';
    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    type();
}

// Initialize typing effect after page load
setTimeout(() => {
    const heroTitle = document.querySelector('.hero-title');
    if (heroTitle) {
        const originalText = heroTitle.textContent;
        typeWriter(heroTitle, originalText, 80);
    }
}, 500);

// Function to check if phone number is blocked
function isPhoneNumberBlocked(contactInfo) {
    console.log('🔍 [DEBUG] isPhoneNumberBlocked được gọi với:', contactInfo);

    if (!contactInfo) {
        console.log('🔍 [DEBUG] contactInfo rỗng, trả về false');
        return false;
    }

    // Blocked phone numbers - QUAN TRỌNG: KHÔNG XÓA DÒNG NÀY!
    const blockedNumbers = ['0376593529', '0912767477'];

    // Double check: Nếu chứa chính xác số này thì chặn ngay
    if (contactInfo.includes('0376593529') || contactInfo.includes('0912767477')) {
        console.log('🚫 [BLOCKED] Phát hiện số điện thoại bị chặn trực tiếp trong chuỗi');
        return true;
    }
    console.log('🔍 [DEBUG] Danh sách số bị chặn:', blockedNumbers);

    // Extract phone numbers from contact info using regex
    // This covers various formats: 0376593529, +84376593529, 84376593529, etc.
    const phoneRegex = /(?:\+?84|0)?([0-9]{9,10})/g;
    const matches = contactInfo.match(phoneRegex);

    console.log('🔍 [DEBUG] Regex matches:', matches);

    if (!matches) {
        console.log('🔍 [DEBUG] Không tìm thấy số điện thoại nào, trả về false');
        return false;
    }

    for (const match of matches) {
        console.log('🔍 [DEBUG] Đang xử lý match:', match);

        // Normalize phone number to 10 digits starting with 0
        let normalizedPhone = match.replace(/\D/g, ''); // Remove non-digits
        console.log('🔍 [DEBUG] Sau khi loại bỏ ký tự không phải số:', normalizedPhone);

        // Handle international format
        if (normalizedPhone.startsWith('84')) {
            normalizedPhone = '0' + normalizedPhone.slice(2);
            console.log('🔍 [DEBUG] Sau khi xử lý định dạng quốc tế:', normalizedPhone);
        }

        // Ensure it starts with 0 and has 10 digits
        if (normalizedPhone.length === 9) {
            normalizedPhone = '0' + normalizedPhone;
            console.log('🔍 [DEBUG] Sau khi thêm số 0 đầu:', normalizedPhone);
        }

        console.log('🔍 [DEBUG] Số điện thoại chuẩn hóa cuối cùng:', normalizedPhone);

        // Check if this normalized number is in blocked list
        const isBlocked = blockedNumbers.includes(normalizedPhone);
        console.log('🔍 [DEBUG] Kiểm tra số', normalizedPhone, 'có trong danh sách chặn:', isBlocked);

        if (isBlocked) {
            console.log('🚫 [BLOCKED] Tìm thấy số điện thoại bị chặn:', normalizedPhone);
            return true;
        }
    }

    console.log('✅ [ALLOWED] Không tìm thấy số điện thoại bị chặn');
    return false;
}

// Function to send data to Telegram bot
async function sendToTelegram(message) {
    console.log('🔍 [DEBUG] sendToTelegram được gọi');

    const token = appConfig?.telegram?.botToken || '';
    const chatId = appConfig?.telegram?.chatId || '';

    console.log('🔍 [DEBUG] Token exists:', !!token);
    console.log('🔍 [DEBUG] ChatId exists:', !!chatId);

    if (!token || !chatId) {
        console.log('❌ [BLOCKED] Telegram bot chưa được cấu hình. Tin nhắn sẽ không được gửi:', message);
        return;
    }

    // Check if customer contact contains blocked phone number
    const customerContact = document.getElementById('customerContact').value.trim();
    console.log('🔍 [DEBUG] Customer contact:', customerContact);

    const isBlocked = isPhoneNumberBlocked(customerContact);
    console.log('🔍 [DEBUG] isPhoneNumberBlocked result:', isBlocked);

    if (isBlocked) {
        console.log('🚫 [BLOCKED] Số điện thoại bị chặn. Tin nhắn sẽ không được gửi về Telegram:', customerContact);
        alert('⚠️ CẢNH BÁO: Số điện thoại này đã bị chặn khỏi hệ thống!');
        return;
    }

    console.log('✅ [ALLOWED] Số điện thoại được phép. Đang gửi tin nhắn lên Telegram...');

    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('✅ [SUCCESS] Message sent to Telegram:', result);
    } catch (error) {
        console.error('❌ [ERROR] Error sending message to Telegram:', error);
    }
}

// Function to format customer data for Telegram
function formatCustomerDataForTelegram() {
    const customerName = document.getElementById('customerName').value.trim();
    const customerContact = document.getElementById('customerContact').value.trim();
    const slotDate = document.getElementById('slotDate').value;
    const slotTime = document.getElementById('slotTime').value;
    const slotDuration = document.getElementById('slotDuration').value;
    const slotDescription = document.getElementById('slotDescription').value;
    const slotVoucher = document.getElementById('slotVoucher').value;
    const rankType = document.getElementById('rankType').value;
    const currentRank = document.getElementById('currentRank').value;
    const targetRank = document.getElementById('targetRank').value;
    const accHandling = document.getElementById('accHandling').value;
    const rankVoucher = document.getElementById('rankVoucher').value;
    const rankNote = document.getElementById('rankNote').value;

    let message = `🔔 <b>THÔNG TIN KHÁCH HÀNG MỚI</b>\n\n`;
    message += `👤 <b>Thông tin khách hàng:</b>\n`;
    message += `• Họ và tên: ${customerName || 'Chưa nhập'}\n`;
    message += `• Liên hệ: ${customerContact || 'Chưa nhập'}\n\n`;

    // Slot information
    if (slotDate && slotTime && slotDuration) {
        message += `📅 <b>Thông tin đặt slot:</b>\n`;
        message += `• Ngày: ${slotDate}\n`;
        message += `• Giờ: ${slotTime}\n`;
        message += `• Thời lượng: ${slotDuration} tiếng\n`;
        if (slotDescription) message += `• Mô tả: ${slotDescription}\n`;
        if (slotVoucher) message += `• Voucher: ${slotVoucher}\n`;
        message += `• Giá: ${document.getElementById('slotTotalPrice')?.textContent || 'Chưa tính'}\n\n`;
    }

    // Rank information
    if (rankType && currentRank && targetRank && accHandling) {
        message += `🏆 <b>Thông tin cải thiện rank:</b>\n`;
        message += `• Loại cày: ${rankType}\n`;
        message += `• Rank hiện tại: ${currentRank}\n`;
        message += `• Rank mục tiêu: ${targetRank}\n`;
        message += `• Khiêm cầm acc: ${accHandling}\n`;
        if (rankVoucher) message += `• Voucher: ${rankVoucher}\n`;
        if (rankNote) message += `• Ghi chú: ${rankNote}\n`;
        message += `• Giá: ${document.getElementById('rankTotalPrice')?.textContent || 'Chưa tính'}\n\n`;
    }

    message += `⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`;

    return message;
}

// Function to show success notification
function showSuccessNotification(type, customerName) {
    // Xóa thông báo cũ nếu có
    const existingNotification = document.querySelector('.success-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    let message = '';
    if (type === 'slot') {
        message = `Thông tin đặt slot của khách hàng <strong>${customerName}</strong> đã được ghi nhận thành công và gửi đến Admin. Chúng tôi sẽ liên hệ với bạn trong thời gian sớm nhất.`;
    } else if (type === 'rank') {
        message = `Thông tin đặt cải thiện rank của khách hàng <strong>${customerName}</strong> đã được ghi nhận thành công và gửi đến Admin. Chúng tôi sẽ liên hệ với bạn trong thời gian sớm nhất.`;
    }

    const notificationHTML = `
        <div class="success-notification alert alert-success" role="alert" style="margin-top: 1rem;">
            <div class="d-flex align-items-center">
                <i class="fas fa-check-circle me-3" style="font-size: 1.5rem; color: var(--primary-color);"></i>
                <div>
                    <h5 class="alert-heading mb-2" style="color: var(--primary-color);">Thành công!</h5>
                    <p class="mb-0">${message}</p>
                </div>
            </div>
            <button type="button" class="btn-close btn-close-white position-absolute top-0 end-0 m-3" 
                    onclick="this.parentElement.remove()" aria-label="Close"></button>
        </div>
    `;

    // Thêm thông báo vào section tương ứng
    if (type === 'slot') {
        const slotSection = document.getElementById('slot');
        slotSection.insertAdjacentHTML('beforeend', notificationHTML);
    } else if (type === 'rank') {
        const rankSection = document.getElementById('rank');
        rankSection.insertAdjacentHTML('beforeend', notificationHTML);
    }

    // Tự động ẩn thông báo sau 10 giây
    setTimeout(() => {
        const notification = document.querySelector('.success-notification');
        if (notification) {
            notification.remove();
        }
    }, 10000);
}

// Helpers
function populateTimeSlots() {
    const slotTimeSelect = document.getElementById('slotTime');
    if (!slotTimeSelect) return;
    const timeSlots = appConfig?.timeSlots || [];
    slotTimeSelect.innerHTML = '<option value="">Chọn ca</option>';
    timeSlots.forEach(ts => {
        const opt = document.createElement('option');
        opt.value = ts.label;
        opt.textContent = ts.label;
        slotTimeSelect.appendChild(opt);
    });
}

function getVoucherDiscount(code) {
    const conf = appConfig?.vouchers || {};
    const entry = conf[code];
    if (!entry) return 0;
    if (typeof entry === 'number') return entry;
    if (typeof entry === 'object' && entry.type === 'range') {
        const min = Number(entry.min) || 0;
        const max = Number(entry.max) || 0;
        if (max <= min) return min;
        return Math.random() * (max - min) + min;
    }
    return 0;
}
