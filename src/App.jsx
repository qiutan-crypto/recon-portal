import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import {
  Loader2,
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Search,
  Filter,
  Download,
  Shield,
  User,
  Plus,
  Trash,
  RefreshCcw,
  Trash2,
  Save,
  Edit,
  Eye,
  Lock,
  Users,
  UserPlus,
  Crown,
  KeyRound,
  Mail
} from 'lucide-react';

// --- Configuration & Constants ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// Helper: Process Spreadsheet Worksheet
// Convert Excel serial date numbers to MM/DD/YYYY string
const excelDateToString = (val) => {
  if (val === null || val === undefined || val === '') return null;
  // If it's already a Date object (from cellDates:true)
  if (val instanceof Date) {
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    const y = val.getFullYear();
    return `${m}/${d}/${y}`;
  }
  // If it's a number that looks like an Excel serial date (between 1 and 2958465 = year 9999)
  if (typeof val === 'number' && val > 0 && val < 2958466) {
    // Excel serial date: days since 1/1/1900 (with the 1900 leap year bug)
    const utcDays = Math.floor(val) - 25569; // Convert to Unix epoch days
    const utcMs = utcDays * 86400 * 1000;
    const dt = new Date(utcMs);
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const y = dt.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  // If it's a string that looks like a date, return as-is
  return String(val);
};

const processWorksheet = (ws, surveyType) => {
  // Smart Header Detection
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  let headerRowIndex = 0;
  const targetKeywords = ['date', 'amount', 'balance', 'description', 'reference', 'details', 'payee'];

  for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;
    const rowStr = row.join(' ').toLowerCase();
    const matchCount = targetKeywords.filter(kw => rowStr.includes(kw)).length;
    if (matchCount >= 2) {
      headerRowIndex = i;
      break;
    }
  }

  const jsonData = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex });

  if (jsonData.length === 0) {
    throw new Error("Could not read any data rows.");
  }

  if (surveyType === 'reconciliation') {
    const mapped = jsonData.map(row => {
      const lowerKeys = Object.keys(row).reduce((acc, outputKey) => {
        acc[outputKey.toLowerCase().trim()] = row[outputKey];
        return acc;
      }, {});

      const getValue = (keywords) => {
        const key = Object.keys(lowerKeys).find(k => keywords.some(kw => k.includes(kw)));
        return key ? lowerKeys[key] : undefined;
      };

      const dateRaw = getValue(['date', 'time']);
      // Convert Excel serial dates to readable format
      const date = dateRaw ? excelDateToString(dateRaw) : new Date().toISOString().split('T')[0];

      let description = getValue(['desc', 'memo', 'detail', 'narrative']) || 'Unknown';
      const payee = getValue(['payee', 'merchant']);

      if (payee && String(payee).trim() !== '' && !String(description).toLowerCase().includes(String(payee).toLowerCase())) {
        description = `${description} - ${payee}`;
      }

      let amount = 0;
      let amountRaw = getValue(['amount', 'amt', 'value', 'price', 'cost']);

      if (amountRaw !== undefined) {
        if (typeof amountRaw === 'string') {
          // Handle currency symbols and negative signs potentially in parentheses
          let cleanCtx = amountRaw.replace(/[$,\s]/g, '');
          if (cleanCtx.includes('(') && cleanCtx.includes(')')) {
            cleanCtx = '-' + cleanCtx.replace(/[()]/g, '');
          }
          amountRaw = parseFloat(cleanCtx);
        }
        amount = isNaN(amountRaw) ? 0 : amountRaw;
      } else {
        const debitRaw = getValue(['payment', 'debit', 'withdrawal', 'decrea', 'out']);
        const creditRaw = getValue(['deposit', 'credit', 'increa', 'in']);

        const parseVal = (v) => {
          if (!v) return 0;
          if (typeof v === 'number') return v;
          return parseFloat(v.replace(/[$,]/g, '')) || 0;
        };

        const debit = parseVal(debitRaw);
        const credit = parseVal(creditRaw);
        if (debit !== 0 || credit !== 0) {
          amount = credit - debit;
        }
      }

      return {
        date: date,
        dateCallback: !dateRaw,
        description: description,
        amount: amount,
        type: amount < 0 ? 'Withdrawal' : 'Deposit',
        original: row
      };
    }).filter(tx => {
      if (tx.amount === 0) return false;
      const allValues = Object.values(tx.original).join(' ').toLowerCase();
      if (allValues.includes('total') || allValues.includes('balance')) return false;
      if (tx.description === 'Unknown' && tx.dateCallback) return false;
      const desc = String(tx.description).toLowerCase();
      if (desc.startsWith('total')) return false;
      return true;
    });

    return { transactions: mapped, rowCount: jsonData.length };
  } else {
    // General Survey - Extract Headers
    const headers = Object.keys(jsonData[0] || {});
    const fields = headers.map(h => ({
      label: h,
      type: 'text'
    }));
    return { fields };
  }
};

/**
 * Main Application Component
 */
function App() {
  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState(null); // 'superuser' | 'administrator' | null
  const [userDisplayName, setUserDisplayName] = useState(''); // for email signature
  const [customerCaseNumber, setCustomerCaseNumber] = useState(null); // for customer login
  const [view, setView] = useState('dashboard');
  const [currentSurveyId, setCurrentSurveyId] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUserRole = async (userId) => {
    try {
      console.log('[Auth] Fetching role for userId:', userId);
      const { data, error } = await supabase
        .from('user_profiles')
        .select('role, display_name')
        .eq('id', userId)
        .single();
      console.log('[Auth] Role fetch result:', { data, error });
      if (error) {
        console.warn('[Auth] Role fetch error:', error.message);
        setUserRole(null);
        setUserDisplayName('');
      } else {
        setUserRole(data ? data.role : null);
        setUserDisplayName(data?.display_name || 'Five Star Tax');
      }
    } catch (e) {
      console.error('[Auth] Error fetching role:', e);
      setUserRole(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const surveyId = params.get('survey_id');
    if (surveyId) {
      setCurrentSurveyId(surveyId);
      setView('take-survey');
      setLoading(false);
      return;
    }

    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        console.log('[Auth] getSession result:', session ? session.user.email : 'no session');
        setSession(session);
        if (session) {
          fetchUserRole(session.user.id);
        } else {
          setLoading(false);
        }
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
        console.log('[Auth] onAuthStateChange event:', _event, session ? session.user.email : 'no session');
        setSession(session);
        if (session) {
          await fetchUserRole(session.user.id);
        } else {
          setUserRole(null);
          setLoading(false);
        }
      });

      return () => subscription.unsubscribe();
    } else {
      setLoading(false);
    }
  }, []);

  const handleCustomerLogin = (caseNumber) => setCustomerCaseNumber(caseNumber);
  const handleCustomerLogout = () => { setCustomerCaseNumber(null); setView('dashboard'); };
  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('Sign out error:', e);
    }
    // Clear any cached Supabase tokens
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-')) localStorage.removeItem(key);
    });
    setUserRole(null);
    setSession(null);
    setView('dashboard');
  };

  if (loading) return <LoadingScreen />;
  if (!supabase) return <ConfigErrorScreen />;

  const isStaffLoggedIn = session && userRole;
  const isCustomerLoggedIn = !!customerCaseNumber;
  const showAuth = !isStaffLoggedIn && !isCustomerLoggedIn && view !== 'take-survey';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      <NavBar
        session={session}
        userRole={userRole}
        customerCaseNumber={customerCaseNumber}
        onSignOut={handleSignOut}
        onCustomerSignOut={handleCustomerLogout}
      />

      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {showAuth ? (
          <AuthScreen onCustomerLogin={handleCustomerLogin} />
        ) : view === 'take-survey' ? (
          <SurveyRespondentView surveyId={currentSurveyId} />
        ) : isCustomerLoggedIn ? (
          <CustomerDashboard
            view={view}
            setView={setView}
            caseNumber={customerCaseNumber}
          />
        ) : userRole === 'superuser' ? (
          <SuperuserDashboard
            session={session}
            view={view}
            setView={setView}
            currentSurveyId={currentSurveyId}
            setCurrentSurveyId={setCurrentSurveyId}
            userDisplayName={userDisplayName}
          />
        ) : userRole === 'administrator' ? (
          <AdminDashboard
            session={session}
            view={view}
            setView={setView}
            currentSurveyId={currentSurveyId}
            setCurrentSurveyId={setCurrentSurveyId}
            userDisplayName={userDisplayName}
          />
        ) : session ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-slate-900 mb-2">Access Pending</h2>
              <p className="text-slate-500">Your account has not been assigned a role yet. Please contact the administrator.</p>
              <button onClick={handleSignOut} className="mt-4 text-indigo-600 hover:underline font-medium">Sign Out</button>
            </div>
          </div>
        ) : null}
      </main>

      <Footer />
    </div>
  );
}

// --- Sub-Components ---

function NavBar({ session, userRole, customerCaseNumber, onSignOut, onCustomerSignOut }) {
  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900 tracking-tight">ReconPortal</span>
          </div>

          <div className="flex items-center space-x-4">
            {customerCaseNumber && (
              <>
                <span className="flex items-center px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-700">
                  <KeyRound className="w-3 h-3 mr-1" />
                  Case #{customerCaseNumber}
                </span>
                <button
                  onClick={onCustomerSignOut}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-red-500 transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </>
            )}
            {session && userRole && (
              <>
                <span className={`flex items-center px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider ${userRole === 'superuser' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                  {userRole === 'superuser' ? <Crown className="w-3 h-3 mr-1" /> : <Shield className="w-3 h-3 mr-1" />}
                  {userRole}
                </span>
                <div className="h-6 w-px bg-slate-200 mx-2"></div>
                <span className="hidden sm:inline-block text-sm text-slate-600">
                  {session.user.email}
                </span>
                <button
                  onClick={onSignOut}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-red-500 transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

function AdminDashboard({ session, view, setView, currentSurveyId, setCurrentSurveyId, userDisplayName }) {
  const [extractedData, setExtractedData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [surveys, setSurveys] = useState([]);
  const [customers, setCustomers] = useState([]); // [NEW]
  const [selectedCustomerId, setSelectedCustomerId] = useState(''); // [NEW]

  const [surveyType, setSurveyType] = useState('reconciliation');
  const [inputType, setInputType] = useState('upload');
  const [pasteContent, setPasteContent] = useState('');

  // New Customer Form State
  const [newCustomer, setNewCustomer] = useState({
    case_number: '',
    first_name: '',
    last_name: '',
    email: '',
    phone_number: ''
  });
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [surveyTitle, setSurveyTitle] = useState(''); // [NEW]

  // Category Management State
  const [surveyCategories, setSurveyCategories] = useState(['Personal Expense', 'Loan', 'Business Expense', 'Account Transfer']);
  const [newCategoryInput, setNewCategoryInput] = useState('');


  const [viewingCustomerId, setViewingCustomerId] = useState(null); // [NEW]

  const fileInputRef = useRef(null);
  const spreadsheetInputRef = useRef(null);

  useEffect(() => {
    if (view === 'dashboard') {
      fetchSurveys();
      fetchCustomers();
    }
    if (view === 'customers') fetchCustomers();
    if (view === 'create-survey') fetchCustomers();
    if (view === 'customer-responses') { fetchCustomers(); fetchSurveys(); }
  }, [view]);

  const fetchSurveys = async () => {
    // Fetch only surveys for this admin's customers
    const { data: myCustomers } = await supabase.from('customers').select('id').eq('created_by', session.user.id);
    const customerIds = (myCustomers || []).map(c => c.id);
    if (customerIds.length === 0) { setSurveys([]); return; }
    const { data } = await supabase.from('surveys').select('*, customers(name, email)').in('customer_id', customerIds).order('created_at', { ascending: false });
    if (data) setSurveys(data);
  };

  const fetchCustomers = async () => {
    const { data } = await supabase.from('customers').select('*').eq('created_by', session.user.id).order('name');
    if (data) setCustomers(data);
  };

  const createCustomer = async () => {
    if (!newCustomer.first_name || !newCustomer.last_name) return alert('First name and last name are required');
    try {
      const customerData = {
        first_name: newCustomer.first_name,
        last_name: newCustomer.last_name,
        name: `${newCustomer.first_name} ${newCustomer.last_name}`,
        email: newCustomer.email || null,
        phone_number: newCustomer.phone_number || null,
        case_number: newCustomer.case_number || null,
        created_by: session.user.id
      };

      const { data, error } = await supabase.from('customers').insert(customerData).select();
      if (error) throw error;

      setShowCreateCustomer(false);
      setNewCustomer({ case_number: '', first_name: '', last_name: '', email: '', phone_number: '' });
      fetchCustomers();

      if (data && data[0]) {
        if (confirm('Customer added! Do you want to create a survey for them now?')) {
          startSurveyForCustomer(data[0].id);
        }
      }
    } catch (e) {
      alert(e.message);
    }
  };

  const startSurveyForCustomer = (customerId) => {
    setSelectedCustomerId(customerId);
    setSurveyType('reconciliation');
    setInputType('upload');
    setExtractedData(null);
    setSurveyTitle('');
    setView('create-survey');
  };

  const deleteSurvey = async (surveyid, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this survey? This cannot be undone.")) return;

    // Optimistic Update
    setSurveys(prev => prev.filter(s => s.id !== surveyid));

    try {
      console.log("Deleting survey:", surveyid);

      // 1. Delete associated responses first (Manual Cascade)
      const { error: respError } = await supabase.from('responses').delete().eq('survey_id', surveyid);
      if (respError) {
        console.warn("Error deleting responses:", respError);
        throw respError;
      }

      // 2. Delete survey & verify
      const { data, error } = await supabase.from('surveys').delete().eq('id', surveyid).select();

      if (error) {
        console.error("Delete failed:", error);
        await fetchSurveys();
        throw error;
      }

      if (!data || data.length === 0) {
        console.warn("Delete returned 0 rows. RLS might be blocking or ID not found.");
        throw new Error("Deletion failed. Policy check required (RLS).");
      }

      // Refresh from server to be sure
      await fetchSurveys();
      alert("Survey deleted.");
    } catch (err) {
      await fetchSurveys(); // Revert optimistic
      alert("Error deleting survey: " + err.message);
    }
  };

  const publishToClipboard = async (survey, customer, e) => {
    if (e) e.stopPropagation();

    const name = customer?.first_name || 'Client';
    const email = customer?.email || '';
    const surveyUrl = `https://recon-portal-pied.vercel.app/?survey_id=${survey.id}`;
    const subject = `Action Required: Transaction Classification Questions`;
    const senderName = userDisplayName || 'Five Star Tax Team';

    const textContent = `Hi ${name},

I’m reviewing your recent transactions and need a few quick clarifications to classify them correctly. Please complete this short survey at your convenience:

${surveyUrl}

Thanks for your help,
${senderName}`;

    // Try clipboard first
    try {
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <p>Hi ${name},</p>
          <p>I’m reviewing your recent transactions and need a few quick clarifications to classify them correctly. Please complete this short survey at your convenience:</p>
          <p style="margin: 20px 0;">
            <a href="${surveyUrl}" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
              Open Survey
            </a>
          </p>
          <p style="font-size: 13px; color: #666; margin-top: 20px;">
            Link: ${surveyUrl}
          </p>
          <p>Thanks for your help,<br/>${senderName}</p>
        </div>
      `;

      const blobHtml = new Blob([htmlContent], { type: 'text/html' });
      const blobText = new Blob([textContent], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);

      const owaLink = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(email)}&subject=${encodeURIComponent(subject)}`;
      if (confirm("Email content copied to clipboard!\n\n1. Outlook Web will open for you.\n2. Click inside the message body.\n3. Press Ctrl+V to paste.\n\nOpen Outlook now?")) {
        window.open(owaLink, '_blank');
      }
      return;
    } catch (err) {
      console.warn("Clipboard write failed, using mailto fallback:", err);
    }

    // Fallback: open mailto link directly
    const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textContent)}`;
    alert(`Opening email draft...\n\nPlease check your email app and click SEND to invite the client.`);
    window.open(mailtoUrl, '_blank');
  };

  // --- Processing Logic ---

  const processReconciliationData = async (text, mimeType = 'text/plain') => {
    if (!genAI) return;
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `
      Analyze this financial data. Extract transactions:
      - Date (YYYY-MM-DD)
      - Description
      - Amount (number)
      - Type (Deposit/Withdrawal)
      Return JSON: { "transactions": [{ "date": "...", "description": "...", "amount": 0, "type": "..." }] }
    `;

    // logic to handle text vs base64 image...
    // For simplicity in this demo, assumes text/base64 passed correctly
    // implementation below
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsProcessing(true);

    try {
      const fileType = file.name.split('.').pop().toLowerCase();
      const isSpreadsheet = ['csv', 'xlsx', 'xls'].includes(fileType);

      if (isSpreadsheet) {
        // Handle Spreadsheet Logic
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const bstr = evt.target.result;


            // Smart Header Detection & Processing using helper
            const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];

            const { transactions, fields, rowCount } = processWorksheet(ws, surveyType);

            if (transactions) {
              alert(`Successfully mapped ${transactions.length} transactions from ${rowCount} rows.`);
              setExtractedData({ transactions });
            } else if (fields) {
              setExtractedData({ fields });
            }
            setView('preview-data');

          } catch (err) {
            console.error(err);
            alert("Error parsing spreadsheet: " + err.message);
          } finally {
            setIsProcessing(false);
          }
        };
        reader.readAsBinaryString(file);
        return;
      }

      // Handle PDF/Image Logic (AI)
      if (!genAI) { alert("AI not initialized"); setIsProcessing(false); return; }

      const base64Data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
      });

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      let prompt;
      if (surveyType === 'reconciliation') {
        prompt = `
          Analyze this bank statement. Extract:
          - Date (YYYY-MM-DD)
          - Description
          - Amount (number, negative for withdrawal)
          - Type (Deposit/Withdrawal)
          Return JSON: { "transactions": [{ "date": "...", "description": "...", "amount": 0, "type": "..." }] }
        `;
      } else {
        prompt = `
          Analyze this form/document. Create a list of fields for a survey.
          Extract:
          - label (Question text)
          - type (text, number, date, select, checkbox)
          - options (array of strings if type is select/checkbox)
          Return JSON: { "fields": [{ "label": "...", "type": "...", "options": [...] }] }
        `;
      }

      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType: file.type } }
      ]);

      const json = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, '').trim());
      setExtractedData(json);
      setView('preview-data');

    } catch (error) {
      alert("Error: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePasteProcess = async () => {
    if (!pasteContent) return;
    setIsProcessing(true);

    // 1. Attempt Deterministic Parsing (XLSX/TSV)
    try {
      console.log("Attempting to parse pasted text as spreadsheet data...");
      // Use 'string' type to read TSV/CSV text
      const wb = XLSX.read(pasteContent, { type: 'string', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];

      // Use our robust helper
      const { transactions, fields } = processWorksheet(ws, surveyType);

      if (transactions && transactions.length > 0) {
        alert(`Successfully parsed ${transactions.length} transactions from text!`);
        setExtractedData({ transactions });
        setView('preview-data');
        setIsProcessing(false);
        return;
      } else if (fields && fields.length > 0) {
        setExtractedData({ fields });
        setView('preview-data');
        setIsProcessing(false);
        return;
      }
    } catch (e) {
      console.warn("Deterministic parsing failed, falling back to AI:", e);
      // Continue to AI fallback if deterministic parsing fails/finds nothing
    }

    if (!genAI) { setIsProcessing(false); return; }

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = surveyType === 'reconciliation'
        ? `
          Analyze this text which may be a copy-pasted table.
          Extract transactions into a clean JSON format.
          Rules:
          - Date: YYYY-MM-DD.
          - Description: text.
          - Amount: number (negative for withdrawal).
          - Type: Deposit/Withdrawal.
          Input: ${pasteContent}
          Return JSON: { "transactions": [...] }
        `
        : `Analyze this text for survey fields. Input: ${pasteContent}. Return JSON: { "fields": [...] }`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      console.log("Raw AI Response:", responseText); // For debugging

      // Robust JSON extraction
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");

      const json = JSON.parse(jsonMatch[0]);

      if (!json.transactions && !json.fields) {
        throw new Error("Invalid JSON structure returned");
      }

      setExtractedData(json);
      setView('preview-data');
    } catch (e) {
      console.error(e);
      alert("Failed to parse: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };


  if (view === 'admin-results' && currentSurveyId) {
    return <SurveyResults surveyId={currentSurveyId} onBack={() => setView('dashboard')} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="text-slate-500">Manage client surveys and reconciliations</p>
        </div>
        <div className="flex space-x-2 items-center">
          <button
            onClick={() => setView('customers')}
            className={`px-4 py-2 rounded-xl font-medium shadow-sm transition-all flex items-center ${view === 'customers' ? 'bg-indigo-100 text-indigo-700' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <User className="w-5 h-5 mr-2" />
            Customers
          </button>
        </div>
      </div>

      {(view === 'dashboard' || view === 'customers') && (
        <div className="space-y-6">
          {/* Customer Header with Create Button */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800">Customer Directory</h3>
              <button onClick={() => setShowCreateCustomer(true)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold text-sm hover:bg-indigo-700 active:scale-95 transition-all flex items-center">
                <UserPlus className="w-4 h-4 mr-1.5" /> Create Customer
              </button>
            </div>
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-6 py-3">Case #</th>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Contact</th>
                  <th className="px-6 py-3">Joined</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 group">
                    <td className="px-6 py-3 text-slate-500 font-mono text-xs">{c.case_number || '-'}</td>
                    <td className="px-6 py-3 font-medium text-slate-900">{c.first_name} {c.last_name}</td>
                    <td className="px-6 py-3">
                      <div className="text-xs">
                        <div className="text-slate-900">{c.email}</div>
                        <div className="text-slate-500">{c.phone_number}</div>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => startSurveyForCustomer(c.id)}
                          className="text-indigo-600 hover:text-indigo-900 font-medium text-xs flex items-center bg-indigo-50 px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Create Survey"
                        >
                          <Plus className="w-3 h-3 mr-1" /> Create
                        </button>
                        <button
                          onClick={() => { setViewingCustomerId(c.id); setView('customer-responses'); }}
                          className="text-emerald-600 hover:text-emerald-900 font-medium text-xs flex items-center bg-emerald-50 px-3 py-1.5 rounded-lg"
                          title="View Responses"
                        >
                          <FileText className="w-3 h-3 mr-1" /> View Surveys
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr><td colSpan="3" className="px-6 py-8 text-center text-slate-400">No customers found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Create Customer Modal */}
          {showCreateCustomer && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreateCustomer(false)}>
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-slate-900 mb-4">Create New Customer</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">First Name *</label>
                      <input type="text" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        value={newCustomer.first_name} onChange={(e) => setNewCustomer({ ...newCustomer, first_name: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Last Name *</label>
                      <input type="text" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        value={newCustomer.last_name} onChange={(e) => setNewCustomer({ ...newCustomer, last_name: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                    <input type="email" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                    <input type="text" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={newCustomer.phone_number} onChange={(e) => setNewCustomer({ ...newCustomer, phone_number: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Case Number</label>
                    <input type="text" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={newCustomer.case_number} onChange={(e) => setNewCustomer({ ...newCustomer, case_number: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button onClick={() => setShowCreateCustomer(false)}
                    className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium text-sm">Cancel</button>
                  <button onClick={createCustomer}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 font-medium text-sm">Create Customer</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'customer-responses' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-200">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Survey History: {customers.find(c => c.id === viewingCustomerId)?.name || 'Unknown Customer'}
              </h2>
              <p className="text-slate-500 text-sm">Case #: {customers.find(c => c.id === viewingCustomerId)?.case_number || '-'}</p>
            </div>
            <button onClick={() => setView('customers')} className="text-slate-500 hover:text-indigo-600 font-medium">
              &larr; Back to Customers
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {surveys.filter(s => s.customer_id === viewingCustomerId).length === 0 ? (
              <div className="col-span-full bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
                No surveys found for this customer.
                <br />
                <button onClick={() => startSurveyForCustomer(viewingCustomerId)} className="mt-4 text-indigo-600 font-bold hover:underline">
                  Create One Now
                </button>
              </div>
            ) : (
              surveys.filter(s => s.customer_id === viewingCustomerId).map(survey => (
                <div
                  key={survey.id}
                  onClick={() => { setCurrentSurveyId(survey.id); setView('admin-results'); }}
                  className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-2 rounded-lg text-white ${survey.survey_type === 'general' ? 'bg-purple-500' : 'bg-indigo-500'}`}>
                      <FileText className="w-5 h-5" />
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${survey.status === 'published' ? 'bg-green-100 text-green-700' :
                      survey.status === 'responded' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                      {survey.status}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">{survey.title}</h3>
                  <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-2">{survey.survey_type || 'Reconciliation'}</p>
                  <p className="text-sm text-slate-500 mb-4">Created: {new Date(survey.created_at).toLocaleDateString()}</p>

                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center text-indigo-600 font-medium text-sm group-hover:translate-x-1 transition-transform">
                      View Response <ChevronRight className="w-4 h-4 ml-1" />
                    </div>
                    <div className="flex space-x-1">
                      <button
                        onClick={(e) => deleteSurvey(survey.id, e)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                        title="Delete Survey"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          const customer = customers.find(c => c.id === viewingCustomerId);
                          publishToClipboard(survey, customer, e);
                        }}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                        title="Resend Email (Republish)"
                      >
                        <RefreshCcw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {
        view === 'create-survey' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Create New Survey</h2>
              <button onClick={() => setView('dashboard')} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            {/* 0. Select Customer [NEW] */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">1. Assign to Customer</label>
              <select
                className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
              >
                <option value="">-- Select a Customer --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                ))}
              </select>
              {customers.length === 0 && (
                <p className="text-xs text-red-500 mt-1">No customers found. Please add a customer first.</p>
              )}
            </div>

            {/* 1. Select Type */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">2. Select Survey Type</label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setSurveyType('reconciliation')}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${surveyType === 'reconciliation' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}
                >
                  <div className="font-bold text-slate-900">Reconciliation</div>
                  <div className="text-sm text-slate-500">Bank statements, transaction categorization</div>
                </button>
                <button
                  onClick={() => setSurveyType('general')}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${surveyType === 'general' ? 'border-purple-600 bg-purple-50' : 'border-slate-200 hover:border-purple-300'}`}
                >
                  <div className="font-bold text-slate-900">General Survey</div>
                  <div className="text-sm text-slate-500">Forms, questionnaires, data collection</div>
                </button>
              </div>
            </div>

            {/* 2. Select Source */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">3. Choose Data Source</label>
              <div className="flex space-x-2 mb-4">
                {['upload', 'paste'].map(t => (
                  <button
                    key={t}
                    onClick={() => setInputType(t)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${inputType === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {t}
                  </button>
                ))}

              </div>

              {/* Title Input */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">Survey Title</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g. Q1 2026 Reconciliation"
                  value={surveyTitle}
                  onChange={(e) => setSurveyTitle(e.target.value)}
                />
              </div>

              {inputType === 'upload' && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*,application/pdf,.csv,.xlsx,.xls" onChange={handleFileUpload} />
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-600">Upload PDF, Image, Excel, or CSV</p>
                </div>
              )}

              {inputType === 'paste' && (
                <div className="space-y-4">
                  <textarea
                    className="w-full h-48 p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Paste text contents here..."
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                  />
                  <button
                    onClick={handlePasteProcess}
                    disabled={!pasteContent}
                    className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Process Text
                  </button>
                </div>
              )}

            </div>

            {/* 4. Manage Categories */}
            {surveyType === 'reconciliation' && (
              <div className="mt-6 border-t border-slate-100 pt-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">4. Manage Categories</label>
                <div className="flex space-x-2 mb-2">
                  <input
                    type="text"
                    placeholder="Add new category..."
                    className="flex-1 p-2 rounded-lg border border-slate-200 text-sm"
                    value={newCategoryInput}
                    onChange={(e) => setNewCategoryInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (newCategoryInput.trim()) {
                          setSurveyCategories([...surveyCategories, newCategoryInput.trim()]);
                          setNewCategoryInput('');
                        }
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newCategoryInput.trim()) {
                        setSurveyCategories([...surveyCategories, newCategoryInput.trim()]);
                        setNewCategoryInput('');
                      }
                    }}
                    className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium"
                  >
                    Add
                  </button>
                </div>

                <div className="mb-2">
                  <textarea
                    placeholder="Paste a list of categories (comma or newline separated) to add in batch..."
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm h-16"
                    onBlur={(e) => {
                      const val = e.target.value;
                      if (val.trim()) {
                        const newCats = val.split(/[,\n]/).map(s => s.trim()).filter(s => s !== '');
                        const unique = [...new Set([...surveyCategories, ...newCats])];
                        setSurveyCategories(unique);
                        e.target.value = '';
                      }
                    }}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {surveyCategories.map(c => (
                    <span key={c} className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs flex items-center border border-slate-200">
                      {c}
                      <button
                        onClick={() => setSurveyCategories(surveyCategories.filter(cat => cat !== c))}
                        className="ml-1 text-slate-400 hover:text-red-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      }

      {isProcessing && (
        <div className="flex items-center justify-center p-4 text-indigo-600">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Processing data...
        </div>
      )}


      {
        view === 'preview-data' && extractedData && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Preview & Confirm</h2>
                  {selectedCustomerId && customers.find(c => c.id === selectedCustomerId) && (
                    <p className="text-xs text-indigo-600 font-medium mt-1">
                      Assigning to: {customers.find(c => c.id === selectedCustomerId).name}
                    </p>
                  )}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setView('create-survey')}
                    className="px-3 py-1.5 text-slate-600 text-sm font-medium hover:bg-slate-200 rounded-lg"
                  >
                    Discard
                  </button>
                  <button
                    disabled={isProcessing}
                    onClick={async () => {
                      if (!extractedData) return;
                      if (!selectedCustomerId) return alert("Please select a customer first!");
                      setIsProcessing(true);
                      try {
                        if (!session?.access_token) {
                          throw new Error('No active session.');
                        }

                        const surveyId = crypto.randomUUID();
                        const surveyData = {
                          id: surveyId,
                          title: surveyTitle || `${surveyType === 'reconciliation' ? 'Recon' : 'Survey'} - ${new Date().toLocaleDateString()}`,
                          status: 'published',
                          survey_type: surveyType,
                          customer_id: selectedCustomerId,
                          fields: extractedData.transactions || extractedData.fields,
                          raw_data: extractedData,
                          categories: surveyCategories
                        };

                        const response = await fetch(`${SUPABASE_URL}/rest/v1/surveys`, {
                          method: 'POST',
                          headers: {
                            'apikey': SUPABASE_ANON_KEY,
                            'Authorization': `Bearer ${session.access_token}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                          },
                          body: JSON.stringify(surveyData)
                        });

                        if (!response.ok) {
                          const errorText = await response.text();
                          throw new Error(`Insert failed: ${response.status} ${errorText}`);
                        }
                        const customer = customers.find(c => c.id === selectedCustomerId);
                        await publishToClipboard({ id: surveyId, survey_type: surveyType }, customer);
                        alert('Survey published! Don\'t forget to send the email invitation.');
                        setView('dashboard');
                      } catch (e) {
                        alert('Error saving survey: ' + e.message);
                      } finally {
                        setIsProcessing(false);
                      }
                    }}
                    className={`px-3 py-1.5 text-white text-sm font-medium rounded-lg flex items-center shadow-sm ${isProcessing ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                    {isProcessing ? 'Publishing...' : 'Publish & Send Email'}
                  </button>
                </div>
              </div>

              {surveyType === 'reconciliation' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="p-4">Date</th>
                        <th className="p-4">Description</th>
                        <th className="p-4 text-right">Amount</th>
                        <th className="p-4">Category</th>
                        <th className="p-4">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(extractedData.transactions || []).map((tx, i) => (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="p-4">{tx.date}</td>
                          <td className="p-4">{tx.description}</td>
                          <td className="p-4 text-right">{tx.amount}</td>
                          <td className="p-4">
                            <select
                              className="w-full p-2 rounded border border-slate-200 text-sm focus:border-indigo-500 outline-none"
                              value={tx.category || ''}
                              onChange={(e) => {
                                const updated = [...extractedData.transactions];
                                updated[i].category = e.target.value;
                                setExtractedData({ ...extractedData, transactions: updated });
                              }}
                            >
                              <option value="">-- Select --</option>
                              {surveyCategories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="p-4">
                            <input
                              type="text"
                              className="w-full p-2 rounded border border-slate-200 text-sm focus:border-indigo-500 outline-none"
                              placeholder="Notes..."
                              value={tx.notes || ''}
                              onChange={(e) => {
                                const updated = [...extractedData.transactions];
                                updated[i].notes = e.target.value;
                                setExtractedData({ ...extractedData, transactions: updated });
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 grid gap-4">
                  {(extractedData.fields || []).map((f, i) => (
                    <div key={i} className="p-4 border border-slate-200 rounded-lg flex justify-between items-center">
                      <span className="font-medium text-slate-900">{f.label}</span>
                      <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded uppercase">{f.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      }
    </div >
  );
}

function SurveyResults({ surveyId, onBack }) {
  const [survey, setSurvey] = useState(null);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResults();
  }, [surveyId]);

  const fetchResults = async () => {
    try {
      const { data: surveyData } = await supabase.from('surveys').select('*').eq('id', surveyId).single();
      const { data: responseData } = await supabase.from('responses').select('*').eq('survey_id', surveyId);

      setSurvey(surveyData);
      setResponses(responseData || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!survey || responses.length === 0) return;

    // Flatten data: One row per transaction per response
    // For this simple demo, we assume the latest response is the "final" one or we merge
    // Let's just grab the first response's answers for simplicity to demonstrate
    const response = responses[0];
    if (!response) return alert("No responses to export");

    const rows = survey.fields.map((field, idx) => {
      const answer = response.answers[idx] || {};
      return {
        Date: field.date,
        Description: field.description,
        Amount: field.amount,
        Type: field.type,
        Category: answer.category || '',
        Notes: answer.notes || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reconciliation");
    XLSX.writeFile(workbook, `Reconciliation_${survey.title}.xlsx`);
  };

  const exportPDF = () => {
    if (!survey || responses.length === 0) return;
    const response = responses[0];
    if (!response) return alert("No responses to export");

    const doc = new jsPDF();
    doc.text(`Reconciliation Report: ${survey.title}`, 14, 20);

    const tableData = survey.fields.map((field, idx) => {
      const answer = response.answers[idx] || {};
      return [
        field.date,
        field.description,
        typeof field.amount === 'number' ? field.amount.toFixed(2) : field.amount,
        answer.category || '-',
        answer.notes || '-'
      ];
    });

    doc.autoTable({
      head: [['Date', 'Description', 'Amount', 'Category', 'Notes']],
      body: tableData,
      startY: 30,
    });

    doc.save(`Reconciliation_${survey.title}.pdf`);
  };

  if (loading) return <LoadingScreen />;
  if (!survey) return <div>Survey not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="flex items-center text-slate-500 hover:text-indigo-600 transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back
        </button>
        <div className="flex space-x-2">
          <button onClick={exportCSV} className="flex items-center px-4 py-2 bg-green-600 text-white rounded-xl shadow-sm hover:bg-green-700 transition-colors">
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </button>
          <button onClick={exportPDF} className="flex items-center px-4 py-2 bg-red-600 text-white rounded-xl shadow-sm hover:bg-red-700 transition-colors">
            <FileText className="w-4 h-4 mr-2" /> Export PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-900">{survey.title} - Results</h2>
          <p className="text-sm text-slate-500">Total Responses: {responses.length}</p>
        </div>

        {/* Always show table, even if no responses */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3 text-right">Amount</th>
                <th className="px-6 py-3">Category</th>
                <th className="px-6 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {survey.fields.map((field, idx) => {
                // Safely access answer from first response if it exists
                const answer = (responses[0] && responses[0].answers && responses[0].answers[idx]) || {};
                return (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-6 py-3">{field.date}</td>
                    <td className="px-6 py-3 text-slate-900 font-medium">{field.description}</td>
                    <td className="px-6 py-3 text-right font-mono">{typeof field.amount === 'number' ? field.amount.toFixed(2) : field.amount}</td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-1 rounded-md text-xs ${answer.category ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}>
                        {answer.category || 'Pending'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-500 italic">{answer.notes || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {responses.length === 0 && (
            <div className="p-4 bg-slate-50 text-center text-slate-500 italic text-xs border-t border-slate-100">
              No responses received yet. Showing template view.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CustomerDashboard = ({ view, setView, caseNumber }) => {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentSurvey, setCurrentSurvey] = useState(null);

  useEffect(() => {
    fetchMySurveys();
  }, []);

  const fetchMySurveys = async () => {
    try {
      const { data: customerData, error } = await supabase
        .from('customers')
        .select('id')
        .eq('case_number', caseNumber)
        .single();

      if (error || !customerData) {
        setSurveys([]);
        setLoading(false);
        return;
      }

      // Fetch published and responded surveys
      const { data } = await supabase
        .from('surveys')
        .select('*')
        .eq('customer_id', customerData.id)
        .in('status', ['published', 'responded'])
        .order('created_at', { ascending: false });

      setSurveys(data || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (view === 'survey-detail' && currentSurvey) {
    return (
      <SurveyRespondentView
        survey={currentSurvey}
        onBack={() => {
          setView('dashboard');
          setCurrentSurvey(null);
        }}
      />
    );
  }

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome</h1>
        <p className="text-slate-500">Here are the documents pending your review.</p>
      </div>

      {surveys.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">All caught up!</h2>
          <p className="text-slate-500 mt-2">You have no pending reconciliations or surveys.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {surveys.map(survey => (
            <div
              key={survey.id}
              className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group"
              onClick={() => {
                setCurrentSurvey(survey);
                setView('survey-detail');
              }}
            >
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-xl ${survey.survey_type === 'general' ? 'bg-purple-100 text-purple-600' : 'bg-indigo-100 text-indigo-600'}`}>
                  <FileText className="w-6 h-6" />
                </div>
                <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${survey.status === 'responded' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                  {survey.status === 'responded' ? 'Submitted' : 'Action Required'}
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">{survey.title}</h3>
              <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-4">{survey.survey_type || 'Reconciliation'}</p>

              <button className="w-full py-2 bg-slate-900 text-white rounded-lg text-sm font-bold group-hover:bg-indigo-600 transition-colors">
                {survey.status === 'responded' ? 'Edit Response' : 'Start Review'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ReconciliationInterface = ({ survey, onBack }) => {
  const [answers, setAnswers] = useState({});

  const handleReconcileChange = (idx, field, value) => {
    setAnswers(prev => ({
      ...prev,
      [idx]: { ...prev[idx], [field]: value }
    }));
  };

  const handleGeneralChange = (idx, value) => {
    setAnswers(prev => ({
      ...prev,
      [idx]: { value }
    }));
  };

  const isGeneral = survey.survey_type === 'general';
  const categories = survey.categories || ['Personal Expense', 'Loan', 'Business Expense', 'Account Transfer'];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[600px]">
      {/* ... header ... */}
      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
        <div>
          <button onClick={onBack} className="text-slate-500 text-sm hover:text-slate-800 flex items-center mb-1">
            <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back to Dashboard
          </button>
          <h2 className="text-xl font-bold text-slate-900">{survey.title}</h2>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${isGeneral ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'}`}>
          {survey.survey_type || 'Reconciliation'}
        </div>
      </div>

      {/* Content */}
      <div className="flex-grow overflow-y-auto p-0">
        {isGeneral ? (
          <div className="p-8 max-w-2xl mx-auto space-y-6">
            {(survey.fields || []).map((field, idx) => (
              <div key={idx} className="space-y-2">
                <label className="block text-sm font-semibold text-slate-800">{field.label}</label>

                {['text', 'email', 'number', 'date'].includes(field.type) && (
                  <input
                    type={field.type}
                    className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                    onChange={(e) => handleGeneralChange(idx, e.target.value)}
                  />
                )}

                {field.type === 'textarea' && (
                  <textarea
                    className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                    onChange={(e) => handleGeneralChange(idx, e.target.value)}
                  />
                )}

                {(field.type === 'select' || field.type === 'dropdown') && (
                  <select
                    className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none"
                    onChange={(e) => handleGeneralChange(idx, e.target.value)}
                  >
                    <option value="">Select...</option>
                    {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}

                {field.type === 'checkbox' && (
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" className="w-5 h-5 text-purple-600 rounded" onChange={(e) => handleGeneralChange(idx, e.target.checked)} />
                    <span className="text-slate-600">Yes</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-700 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-6 py-3 w-32">Date</th>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3 text-right w-32">Amount</th>
                <th className="px-6 py-3 w-48">Category</th>
                <th className="px-6 py-3 w-64">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(survey.fields || []).map((tx, idx) => (
                <tr key={idx} className="hover:bg-slate-50 group transition-colors">
                  <td className="px-6 py-4">{tx.date}</td>
                  <td className="px-6 py-4 font-medium text-slate-900">{tx.description}</td>
                  <td className={`px-6 py-4 text-right font-mono ${tx.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {typeof tx.amount === 'number' ? tx.amount.toFixed(2) : tx.amount}
                  </td>
                  <td className="px-6 py-4">
                    <select
                      className="w-full p-2 rounded border border-slate-200 text-xs focus:border-indigo-500 outline-none bg-white"
                      value={answers[idx]?.category || ''}
                      onChange={(e) => handleReconcileChange(idx, 'category', e.target.value)}
                    >
                      <option value="">Uncategorized</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <input
                      type="text"
                      placeholder="Add note..."
                      className="w-full p-2 rounded border border-slate-200 text-xs focus:border-indigo-500 outline-none bg-transparent focus:bg-white transition-colors"
                      onChange={(e) => handleReconcileChange(idx, 'notes', e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
        <button
          onClick={async () => {
            try {
              // 1. Submit Response
              const { error } = await supabase.from('responses').insert({
                survey_id: survey.id,
                answers: answers,
                status: 'submitted'
              });
              if (error) throw error;

              // 2. Update Survey Status
              const { error: statusError } = await supabase
                .from('surveys')
                .update({ status: 'responded' })
                .eq('id', survey.id);

              if (statusError) console.warn("Could not update survey status (RLS?):", statusError);

              alert('Response submitted successfully!');
              onBack();
            } catch (e) {
              alert('Error submitting response: ' + e.message);
            }
          }}
          className={`px-6 py-3 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all ${isGeneral ? 'bg-purple-600 shadow-purple-200 hover:bg-purple-700' : 'bg-indigo-600 shadow-indigo-200 hover:bg-indigo-700'}`}
        >
          Submit {isGeneral ? 'Survey' : 'Reconciliation'}
        </button>
      </div>
    </div>
  );
};

function AuthScreen({ onCustomerLogin }) {
  const [loginMode, setLoginMode] = useState('staff'); // 'staff' | 'customer'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleStaffLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, case_number')
        .eq('case_number', caseNumber)
        .single();
      if (error || !data) throw new Error('Invalid case number. Please check and try again.');
      onCustomerLogin(caseNumber);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
        <div className="text-center mb-8">
          <div className="bg-indigo-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Sign In to ReconPortal</h2>
          <p className="text-slate-500 mt-2">Choose your login method</p>
        </div>

        {/* Login Mode Tabs */}
        <div className="flex mb-6 bg-slate-100 rounded-xl p-1">
          <button
            onClick={() => { setLoginMode('staff'); setMessage(null); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center ${loginMode === 'staff' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            <Shield className="w-4 h-4 mr-1.5" />
            Staff Login
          </button>
          <button
            onClick={() => { setLoginMode('customer'); setMessage(null); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center ${loginMode === 'customer' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            <KeyRound className="w-4 h-4 mr-1.5" />
            Customer Login
          </button>
        </div>

        {message && (
          <div className={`p-4 rounded-xl mb-6 flex items-start text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
            {message.type === 'success' ? <CheckCircle className="w-5 h-5 mr-2 shrink-0" /> : <AlertCircle className="w-5 h-5 mr-2 shrink-0" />}
            {message.text}
          </div>
        )}

        {loginMode === 'staff' ? (
          <form onSubmit={handleStaffLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                placeholder="name@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                placeholder="Enter your password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCustomerLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Case Number</label>
              <input
                type="text"
                required
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                placeholder="Enter your case number"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Access My Surveys'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
    </div>
  );
}

function ConfigErrorScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Configuration Missing</h2>
        <p className="text-slate-600 mb-6">
          Please connect Supabase by adding <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your .env file.
        </p>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="bg-white border-t border-slate-200 py-6 mt-8">
      <div className="max-w-7xl mx-auto px-4 text-center text-slate-400 text-sm">
        &copy; {new Date().getFullYear()} ReconPortal. All rights reserved.
      </div>
    </footer>
  );
}

// --- Superuser Dashboard ---
function SuperuserDashboard({ session, view, setView, currentSurveyId, setCurrentSurveyId, userDisplayName }) {
  const [admins, setAdmins] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [activeTab, setActiveTab] = useState('admins');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewingCustomerId, setViewingCustomerId] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ first_name: '', last_name: '', email: '', phone_number: '', case_number: '' });

  // Survey creation state
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [surveyType, setSurveyType] = useState('reconciliation');
  const [inputType, setInputType] = useState('upload');
  const [pasteContent, setPasteContent] = useState('');
  const [surveyTitle, setSurveyTitle] = useState('');
  const [extractedData, setExtractedData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [surveyCategories, setSurveyCategories] = useState(['Personal Expense', 'Loan', 'Business Expense', 'Account Transfer']);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchAdmins();
    fetchAllCustomers();
    fetchAllSurveys();
  }, []);

  const fetchAdmins = async () => {
    const { data } = await supabase.from('user_profiles').select('*').order('created_at');
    if (data) setAdmins(data);
  };

  const fetchAllCustomers = async () => {
    const { data } = await supabase.from('customers').select('*').order('name');
    if (data) setCustomers(data);
  };

  const fetchAllSurveys = async () => {
    const { data } = await supabase.from('surveys').select('*, customers(name, email)').order('created_at', { ascending: false });
    if (data) setSurveys(data);
  };

  const createAdmin = async () => {
    if (!newAdminEmail || !newAdminPassword) return alert('Email and password are required');
    if (newAdminPassword.length < 6) return alert('Password must be at least 6 characters');
    setLoading(true);
    try {
      // Use separate client to avoid logging out superuser
      const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
        email: newAdminEmail,
        password: newAdminPassword,
      });
      if (signUpError) throw signUpError;
      if (!signUpData.user) throw new Error('User creation failed');

      const { error: profileError } = await supabase.from('user_profiles').insert({
        id: signUpData.user.id,
        email: newAdminEmail,
        role: 'administrator',
        display_name: newAdminName || newAdminEmail.split('@')[0],
        created_by: session.user.id
      });
      if (profileError) throw profileError;

      alert('Administrator created successfully!');
      setNewAdminEmail('');
      setNewAdminPassword('');
      setNewAdminName('');
      fetchAdmins();
    } catch (e) {
      alert('Error creating admin: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const removeAdmin = async (adminId) => {
    if (!confirm('Remove this administrator? They will lose access.')) return;
    try {
      const { error } = await supabase.from('user_profiles').delete().eq('id', adminId);
      if (error) throw error;
      fetchAdmins();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const deleteCustomer = async (customerId) => {
    if (!confirm('Delete this customer and all their surveys? This cannot be undone.')) return;
    try {
      const { data: customerSurveys } = await supabase.from('surveys').select('id').eq('customer_id', customerId);
      if (customerSurveys) {
        for (const s of customerSurveys) {
          await supabase.from('responses').delete().eq('survey_id', s.id);
        }
        await supabase.from('surveys').delete().eq('customer_id', customerId);
      }
      const { error } = await supabase.from('customers').delete().eq('id', customerId);
      if (error) throw error;
      fetchAllCustomers();
      fetchAllSurveys();
    } catch (e) {
      alert('Error deleting customer: ' + e.message);
    }
  };

  const createNewCustomer = async () => {
    if (!newCustomer.first_name || !newCustomer.last_name) return alert('First name and last name are required');
    try {
      const { error } = await supabase.from('customers').insert({
        first_name: newCustomer.first_name,
        last_name: newCustomer.last_name,
        name: `${newCustomer.first_name} ${newCustomer.last_name}`,
        email: newCustomer.email || null,
        phone_number: newCustomer.phone_number || null,
        case_number: newCustomer.case_number || null,
        created_by: session.user.id,
      });
      if (error) throw error;
      setCreatingCustomer(false);
      setNewCustomer({ first_name: '', last_name: '', email: '', phone_number: '', case_number: '' });
      fetchAllCustomers();
    } catch (e) {
      alert('Error creating customer: ' + e.message);
    }
  };

  const saveCustomerEdit = async () => {
    if (!editingCustomer) return;
    try {
      const { error } = await supabase.from('customers').update({
        first_name: editingCustomer.first_name,
        last_name: editingCustomer.last_name,
        email: editingCustomer.email,
        phone_number: editingCustomer.phone_number,
        case_number: editingCustomer.case_number,
      }).eq('id', editingCustomer.id);
      if (error) throw error;
      setEditingCustomer(null);
      fetchAllCustomers();
    } catch (e) {
      alert('Error updating customer: ' + e.message);
    }
  };

  const startSurveyForCustomer = (customerId) => {
    setSelectedCustomerId(customerId);
    setSurveyType('reconciliation');
    setInputType('upload');
    setExtractedData(null);
    setSurveyTitle('');
    setView('su-create-survey');
  };

  const suHandleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsProcessing(true);
    try {
      const fileType = file.name.split('.').pop().toLowerCase();
      const isSpreadsheet = ['csv', 'xlsx', 'xls'].includes(fileType);
      if (isSpreadsheet) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const bstr = evt.target.result;
            const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const { transactions, fields } = processWorksheet(ws, surveyType);
            if (transactions) {
              alert(`Successfully mapped ${transactions.length} transactions.`);
              setExtractedData({ transactions });
            } else if (fields) {
              setExtractedData({ fields });
            }
            setView('su-preview-data');
          } catch (err) {
            alert('Error parsing spreadsheet: ' + err.message);
          } finally {
            setIsProcessing(false);
          }
        };
        reader.readAsBinaryString(file);
        return;
      }
      if (!genAI) { alert('AI not initialized'); setIsProcessing(false); return; }
      const base64Data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
      });
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = surveyType === 'reconciliation'
        ? 'Analyze this bank statement. Extract: Date (YYYY-MM-DD), Description, Amount (number, negative for withdrawal), Type (Deposit/Withdrawal). Return JSON: { "transactions": [...] }'
        : 'Analyze this form/document. Create a list of fields for a survey. Extract: label, type (text/number/date/select/checkbox), options. Return JSON: { "fields": [...] }';
      const result = await model.generateContent([prompt, { inlineData: { data: base64Data, mimeType: file.type } }]);
      const json = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, '').trim());
      setExtractedData(json);
      setView('su-preview-data');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const suHandlePasteProcess = async () => {
    if (!pasteContent) return;
    setIsProcessing(true);
    try {
      const wb = XLSX.read(pasteContent, { type: 'string', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const { transactions, fields } = processWorksheet(ws, surveyType);
      if (transactions && transactions.length > 0) {
        alert(`Parsed ${transactions.length} transactions!`);
        setExtractedData({ transactions });
        setView('su-preview-data');
        setIsProcessing(false);
        return;
      } else if (fields && fields.length > 0) {
        setExtractedData({ fields });
        setView('su-preview-data');
        setIsProcessing(false);
        return;
      }
    } catch (e) { console.warn('Deterministic parsing failed, falling back to AI:', e); }
    if (!genAI) { setIsProcessing(false); return; }
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = surveyType === 'reconciliation'
        ? `Analyze this text. Extract transactions into JSON. Rules: Date: YYYY-MM-DD. Amount: number (negative for withdrawal). Type: Deposit/Withdrawal. Input: ${pasteContent}. Return JSON: { "transactions": [...] }`
        : `Analyze this text for survey fields. Input: ${pasteContent}. Return JSON: { "fields": [...] }`;
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in AI response');
      const json = JSON.parse(jsonMatch[0]);
      setExtractedData(json);
      setView('su-preview-data');
    } catch (e) {
      alert('Failed to parse: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const suPublishToClipboard = async (survey, customer) => {
    const name = customer?.first_name || 'Client';
    const email = customer?.email || '';
    const surveyUrl = `https://recon-portal-pied.vercel.app/?survey_id=${survey.id}`;
    const subject = `Action Required: Transaction Classification Questions`;
    const senderName = userDisplayName || 'Five Star Tax Team';

    const textContent = `Hi ${name},

I’m reviewing your recent transactions and need a few quick clarifications to classify them correctly. Please complete this short survey at your convenience:

${surveyUrl}

Thanks for your help,
${senderName}`;

    // Try clipboard first
    try {
      const htmlContent = `<div style="font-family: Arial, sans-serif; color: #333;"><p>Hi ${name},</p><p>I’m reviewing your recent transactions and need a few quick clarifications to classify them correctly. Please complete this short survey at your convenience:</p><p style="margin: 20px 0;"><a href="${surveyUrl}" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Open Survey</a></p><p style="font-size: 13px; color: #666; margin-top: 20px;">Link: ${surveyUrl}</p><p>Thanks for your help,<br/>${senderName}</p></div>`;
      const blobHtml = new Blob([htmlContent], { type: 'text/html' });
      const blobText = new Blob([textContent], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);

      const owaLink = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(email)}&subject=${encodeURIComponent(subject)}`;
      if (confirm('Email content copied to clipboard!\n\n1. Outlook Web will open for you.\n2. Click inside the message body.\n3. Press Ctrl+V to paste.\n\nOpen Outlook now?')) {
        window.open(owaLink, '_blank');
      }
      return;
    } catch (err) {
      console.warn('Clipboard write failed, using mailto fallback:', err);
    }

    // Fallback: open mailto link directly
    const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textContent)}`;
    alert(`Opening email draft...\n\nPlease check your email app and click SEND to invite the client.`);
    window.open(mailtoUrl, '_blank');
  };

  if (view === 'admin-results' && currentSurveyId) {
    return <SurveyResults surveyId={currentSurveyId} onBack={() => { setView('dashboard'); setActiveTab('customers'); }} />;
  }

  // Create Survey - separate full page
  if (view === 'su-create-survey') {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Create New Survey</h2>
            <button onClick={() => setView('dashboard')} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">1. Assign to Customer</label>
            <select className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
              value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}>
              <option value="">-- Select a Customer --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.email})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">2. Select Survey Type</label>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setSurveyType('reconciliation')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${surveyType === 'reconciliation' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                <div className="font-bold text-slate-900">Reconciliation</div>
                <div className="text-sm text-slate-500">Bank statements, transaction categorization</div>
              </button>
              <button onClick={() => setSurveyType('general')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${surveyType === 'general' ? 'border-purple-600 bg-purple-50' : 'border-slate-200 hover:border-purple-300'}`}>
                <div className="font-bold text-slate-900">General Survey</div>
                <div className="text-sm text-slate-500">Forms, questionnaires, data collection</div>
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">3. Choose Data Source</label>
            <div className="flex space-x-2 mb-4">
              {['upload', 'paste'].map(t => (
                <button key={t} onClick={() => setInputType(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${inputType === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">Survey Title</label>
              <input type="text" className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="e.g. Q1 2026 Reconciliation" value={surveyTitle} onChange={(e) => setSurveyTitle(e.target.value)} />
            </div>
            {inputType === 'upload' && (
              <div onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center cursor-pointer hover:bg-slate-50 transition-colors">
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*,application/pdf,.csv,.xlsx,.xls" onChange={suHandleFileUpload} />
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm text-slate-600">Upload PDF, Image, Excel, or CSV</p>
              </div>
            )}
            {inputType === 'paste' && (
              <div className="space-y-4">
                <textarea className="w-full h-48 p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Paste text contents here..." value={pasteContent} onChange={(e) => setPasteContent(e.target.value)} />
                <button onClick={suHandlePasteProcess} disabled={!pasteContent}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">Process Text</button>
              </div>
            )}
          </div>
          {surveyType === 'reconciliation' && (
            <div className="mt-6 border-t border-slate-100 pt-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">4. Manage Categories</label>
              <div className="flex space-x-2 mb-2">
                <input type="text" placeholder="Add new category..." className="flex-1 p-2 rounded-lg border border-slate-200 text-sm"
                  value={newCategoryInput} onChange={(e) => setNewCategoryInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newCategoryInput.trim()) { setSurveyCategories([...surveyCategories, newCategoryInput.trim()]); setNewCategoryInput(''); } }} />
                <button onClick={() => { if (newCategoryInput.trim()) { setSurveyCategories([...surveyCategories, newCategoryInput.trim()]); setNewCategoryInput(''); } }}
                  className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {surveyCategories.map(c => (
                  <span key={c} className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs flex items-center border border-slate-200">
                    {c}
                    <button onClick={() => setSurveyCategories(surveyCategories.filter(cat => cat !== c))} className="ml-1 text-slate-400 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {isProcessing && (
          <div className="flex items-center justify-center p-4 text-indigo-600">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Processing data...
          </div>
        )}
      </div>
    );
  }

  // Preview Data - separate full page
  if (view === 'su-preview-data' && extractedData) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Preview & Confirm</h2>
              {selectedCustomerId && customers.find(c => c.id === selectedCustomerId) && (
                <p className="text-xs text-indigo-600 font-medium mt-1">
                  Assigning to: {customers.find(c => c.id === selectedCustomerId).first_name} {customers.find(c => c.id === selectedCustomerId).last_name}
                </p>
              )}
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setView('su-create-survey')} className="px-3 py-1.5 text-slate-600 text-sm font-medium hover:bg-slate-200 rounded-lg">Discard</button>
              <button
                disabled={isProcessing}
                onClick={async () => {
                  console.log('=== PUBLISH CLICKED ===');
                  if (!extractedData) { alert('No data to publish'); return; }
                  if (!selectedCustomerId) { alert('Please select a customer first!'); return; }
                  setIsProcessing(true);
                  try {
                    // Generate ID client-side to avoid .select().single() hanging
                    const surveyId = crypto.randomUUID();
                    const surveyData = {
                      id: surveyId,
                      title: surveyTitle || `${surveyType === 'reconciliation' ? 'Recon' : 'Survey'} - ${new Date().toLocaleDateString()}`,
                      status: 'published',
                      survey_type: surveyType,
                      customer_id: selectedCustomerId,
                      fields: extractedData.transactions || extractedData.fields,
                      raw_data: extractedData,
                      categories: surveyCategories
                    };
                    if (!session?.access_token) {
                      throw new Error('No active session. Please sign in again.');
                    }

                    const response = await fetch(`${SUPABASE_URL}/rest/v1/surveys`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                      },
                      body: JSON.stringify(surveyData)
                    });

                    if (!response.ok) {
                      const errorText = await response.text();
                      console.error('Fetch error:', response.status, errorText);
                      throw new Error(`Insert failed: ${response.status} ${response.statusText}`);
                    }

                    const customer = customers.find(c => c.id === selectedCustomerId);
                    await suPublishToClipboard({ id: surveyId, survey_type: surveyType }, customer);
                    alert('Survey published! Don\'t forget to send the email invitation.');
                    setView('dashboard');
                    fetchAllSurveys();
                  } catch (e) {
                    console.error('Publish error:', e);
                    alert('Error: ' + e.message);
                  } finally {
                    setIsProcessing(false);
                  }
                }}
                className={`px-3 py-1.5 text-white text-sm font-medium rounded-lg flex items-center shadow-sm ${isProcessing ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                {isProcessing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                {isProcessing ? 'Publishing...' : 'Publish & Send Email'}
              </button>
            </div>
          </div>
          {surveyType === 'reconciliation' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-100 text-slate-700">
                  <tr><th className="p-4">Date</th><th className="p-4">Description</th><th className="p-4 text-right">Amount</th><th className="p-4">Category</th><th className="p-4">Notes</th></tr>
                </thead>
                <tbody>
                  {(extractedData.transactions || []).map((tx, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="p-4">{tx.date}</td>
                      <td className="p-4">{tx.description}</td>
                      <td className="p-4 text-right">{tx.amount}</td>
                      <td className="p-4">
                        <select className="w-full p-2 rounded border border-slate-200 text-sm focus:border-indigo-500 outline-none"
                          value={tx.category || ''} onChange={(e) => {
                            const updated = [...extractedData.transactions];
                            updated[i].category = e.target.value;
                            setExtractedData({ ...extractedData, transactions: updated });
                          }}>
                          <option value="">-- Select --</option>
                          {surveyCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="p-4">
                        <input type="text" className="w-full p-2 rounded border border-slate-200 text-sm focus:border-indigo-500 outline-none"
                          placeholder="Notes..." value={tx.notes || ''} onChange={(e) => {
                            const updated = [...extractedData.transactions];
                            updated[i].notes = e.target.value;
                            setExtractedData({ ...extractedData, transactions: updated });
                          }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 grid gap-4">
              {(extractedData.fields || []).map((f, i) => (
                <div key={i} className="p-4 border border-slate-200 rounded-lg flex justify-between items-center">
                  <span className="font-medium text-slate-900">{f.label}</span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded uppercase">{f.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Superuser Dashboard</h1>
        <p className="text-slate-500">Manage administrators and oversee all customer data</p>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-slate-100 rounded-xl p-1">
        {[
          { key: 'admins', label: 'Administrators', icon: Users },
          { key: 'customers', label: 'All Customers', icon: User },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center ${activeTab === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            <tab.icon className="w-4 h-4 mr-1.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Administrators Tab */}
      {activeTab === 'admins' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <UserPlus className="w-5 h-5 mr-2 text-indigo-600" />
              Add New Administrator
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <input type="text" placeholder="Display Name" autoComplete="off" className="p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                value={newAdminName} onChange={(e) => setNewAdminName(e.target.value)} />
              <input type="email" placeholder="Email Address" autoComplete="off" className="p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                value={newAdminEmail} onChange={(e) => setNewAdminEmail(e.target.value)} />
              <input type="password" placeholder="Temporary Password" autoComplete="new-password" className="p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} />
              <button onClick={createAdmin} disabled={loading}
                className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserPlus className="w-4 h-4 mr-2" /> Add Admin</>}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-semibold text-slate-800">Administrator Directory</h3>
            </div>
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Joined</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {admins.map((admin) => (
                  <tr key={admin.id} className="hover:bg-slate-50 group">
                    <td className="px-6 py-3 font-medium text-slate-900">{admin.display_name || admin.email.split('@')[0]}</td>
                    <td className="px-6 py-3">{admin.email}</td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${admin.role === 'superuser' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
                        }`}>{admin.role}</span>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-500">{new Date(admin.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-3 text-right">
                      {admin.role !== 'superuser' && (
                        <button onClick={() => removeAdmin(admin.id)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium bg-red-50 px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash className="w-3 h-3 inline mr-1" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Customers Tab */}
      {activeTab === 'customers' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800">All Customers (across all administrators)</h3>
              <button onClick={() => setCreatingCustomer(true)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold text-sm hover:bg-indigo-700 active:scale-95 transition-all flex items-center">
                <UserPlus className="w-4 h-4 mr-1.5" /> Create Customer
              </button>
            </div>
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-6 py-3">Case #</th>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Contact</th>
                  <th className="px-6 py-3">Created By</th>
                  <th className="px-6 py-3">Joined</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((c) => {
                  const adminProfile = admins.find(a => a.id === c.created_by);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 group">
                      <td className="px-6 py-3 text-slate-500 font-mono text-xs">{c.case_number || '-'}</td>
                      <td className="px-6 py-3 font-medium text-slate-900">{c.first_name} {c.last_name}</td>
                      <td className="px-6 py-3">
                        <div className="text-xs">
                          <div className="text-slate-900">{c.email}</div>
                          <div className="text-slate-500">{c.phone_number}</div>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-500">
                        {adminProfile ? (adminProfile.display_name || adminProfile.email) : (c.created_by ? 'Unknown' : 'Legacy')}
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString()}</td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => { setViewingCustomerId(c.id); setActiveTab('customer-surveys'); }}
                            className="text-emerald-600 hover:text-emerald-900 font-medium text-xs flex items-center bg-emerald-50 px-3 py-1.5 rounded-lg">
                            <FileText className="w-3 h-3 mr-1" /> Surveys
                          </button>
                          <button
                            onClick={() => startSurveyForCustomer(c.id)}
                            className="text-amber-600 hover:text-amber-900 font-medium text-xs flex items-center bg-amber-50 px-3 py-1.5 rounded-lg">
                            <Plus className="w-3 h-3 mr-1" /> Create
                          </button>
                          <button
                            onClick={() => setEditingCustomer({ ...c })}
                            className="text-indigo-600 hover:text-indigo-900 font-medium text-xs flex items-center bg-indigo-50 px-3 py-1.5 rounded-lg">
                            <FileText className="w-3 h-3 mr-1" /> Edit
                          </button>
                          <button
                            onClick={() => deleteCustomer(c.id)}
                            className="text-red-600 hover:text-red-900 font-medium text-xs flex items-center bg-red-50 px-3 py-1.5 rounded-lg">
                            <Trash className="w-3 h-3 mr-1" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {customers.length === 0 && (
                  <tr><td colSpan="6" className="px-6 py-8 text-center text-slate-400">No customers found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Create Customer Modal */}
          {creatingCustomer && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setCreatingCustomer(false)}>
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-slate-900 mb-4">Create New Customer</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">First Name *</label>
                      <input type="text" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        value={newCustomer.first_name} onChange={(e) => setNewCustomer({ ...newCustomer, first_name: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Last Name *</label>
                      <input type="text" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        value={newCustomer.last_name} onChange={(e) => setNewCustomer({ ...newCustomer, last_name: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                    <input type="email" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                    <input type="text" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={newCustomer.phone_number} onChange={(e) => setNewCustomer({ ...newCustomer, phone_number: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Case Number</label>
                    <input type="text" autoComplete="off" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={newCustomer.case_number} onChange={(e) => setNewCustomer({ ...newCustomer, case_number: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button onClick={() => setCreatingCustomer(false)}
                    className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium text-sm">Cancel</button>
                  <button onClick={createNewCustomer}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 font-medium text-sm">Create Customer</button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Customer Modal */}
          {editingCustomer && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingCustomer(null)}>
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-slate-900 mb-4">Edit Customer</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">First Name</label>
                      <input type="text" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        value={editingCustomer.first_name || ''} onChange={(e) => setEditingCustomer({ ...editingCustomer, first_name: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Last Name</label>
                      <input type="text" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        value={editingCustomer.last_name || ''} onChange={(e) => setEditingCustomer({ ...editingCustomer, last_name: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                    <input type="email" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={editingCustomer.email || ''} onChange={(e) => setEditingCustomer({ ...editingCustomer, email: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                    <input type="text" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={editingCustomer.phone_number || ''} onChange={(e) => setEditingCustomer({ ...editingCustomer, phone_number: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Case Number</label>
                    <input type="text" className="w-full p-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={editingCustomer.case_number || ''} onChange={(e) => setEditingCustomer({ ...editingCustomer, case_number: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button onClick={() => setEditingCustomer(null)}
                    className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium text-sm">Cancel</button>
                  <button onClick={saveCustomerEdit}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 font-medium text-sm">Save Changes</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Customer Surveys Detail */}
      {activeTab === 'customer-surveys' && viewingCustomerId && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-200">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Survey History: {customers.find(c => c.id === viewingCustomerId)?.name || 'Unknown'}
              </h2>
              <p className="text-slate-500 text-sm">Case #: {customers.find(c => c.id === viewingCustomerId)?.case_number || '-'}</p>
            </div>
            <button onClick={() => setActiveTab('customers')} className="text-slate-500 hover:text-indigo-600 font-medium">
              &larr; Back to Customers
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {surveys.filter(s => s.customer_id === viewingCustomerId).length === 0 ? (
              <div className="col-span-full bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
                No surveys found for this customer.
              </div>
            ) : (
              surveys.filter(s => s.customer_id === viewingCustomerId).map(survey => (
                <div
                  key={survey.id}
                  onClick={() => { setCurrentSurveyId(survey.id); setView('admin-results'); }}
                  className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-2 rounded-lg text-white ${survey.survey_type === 'general' ? 'bg-purple-500' : 'bg-indigo-500'}`}>
                      <FileText className="w-5 h-5" />
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${survey.status === 'published' ? 'bg-green-100 text-green-700' :
                      survey.status === 'responded' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                      }`}>{survey.status}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">{survey.title}</h3>
                  <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-2">{survey.survey_type || 'Reconciliation'}</p>
                  <p className="text-sm text-slate-500 mb-4">Created: {new Date(survey.created_at).toLocaleDateString()}</p>
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center text-indigo-600 font-medium text-sm group-hover:translate-x-1 transition-transform">
                      View Response <ChevronRight className="w-4 h-4 ml-1" />
                    </div>
                    <div className="flex space-x-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); if (confirm('Delete this survey?')) { supabase.from('surveys').delete().eq('id', survey.id).then(() => fetchAllSurveys()); } }}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                        title="Delete Survey"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const customer = customers.find(c => c.id === viewingCustomerId);
                          suPublishToClipboard(survey, customer);
                        }}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                        title="Resend Email (Republish)"
                      >
                        <RefreshCcw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

/**
 * Public Survey Respondent View
 */
function SurveyRespondentView({ surveyId, survey: initialSurvey, onBack }) {
  const [survey, setSurvey] = useState(initialSurvey || null);
  const [loading, setLoading] = useState(!initialSurvey);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (initialSurvey) {
      setSurvey(initialSurvey);
      initializeAnswers(initialSurvey);
      setLoading(false);
      return;
    }

    const fetchSurvey = async () => {
      try {
        const { data, error } = await supabase.from('surveys').select('*').eq('id', surveyId).single();
        if (error) throw error;
        setSurvey(data);
        initializeAnswers(data);
      } catch (err) {
        console.error(err);
        alert("Survey not found or invalid link. " + err.message);
      } finally {
        setLoading(false);
      }
    };
    if (surveyId && supabase && !survey) fetchSurvey();
  }, [surveyId, initialSurvey]);

  const initializeAnswers = (data) => {
    const initialAnswers = {};
    if (data.survey_type === 'reconciliation' && Array.isArray(data.fields)) {
      data.fields.forEach((_, idx) => initialAnswers[idx] = { category: '', notes: '' });
    }
    setAnswers(initialAnswers);
  };

  const handleSubmit = async () => {
    if (!survey) return;
    try {
      // 1. Submit Response
      const { error } = await supabase.from('responses').insert({
        survey_id: survey.id,
        answers: answers,
        status: 'submitted'
      });
      if (error) throw error;

      // 2. Update Survey Status
      const { error: statusError } = await supabase
        .from('surveys')
        .update({ status: 'responded' })
        .eq('id', survey.id);

      if (statusError) console.warn("Could not update survey status (RLS?):", statusError);

      setSubmitted(true);
    } catch (e) {
      alert("Error submitting: " + e.message);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>;
  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-2xl shadow-lg text-center max-w-md">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Thank You!</h2>
        <p className="text-slate-600">Your response has been recorded successfully.</p>
      </div>
    </div>
  );
  if (!survey) return <div>Invalid Survey Link</div>;

  return (
    <div className="max-w-3xl mx-auto py-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        <div className="bg-indigo-600 px-8 py-6 text-white">
          {onBack && (
            <button onClick={onBack} className="text-indigo-200 hover:text-white text-sm mb-4 flex items-center transition-colors">
              <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back
            </button>
          )}
          <h1 className="text-2xl font-bold">{survey.title}</h1>
          <p className="opacity-80 text-sm mt-1">Please review and complete the items below.</p>
        </div>

        <div className="p-8 space-y-8">
          {survey.survey_type === 'reconciliation' ? (
            <div className="space-y-6">
              {(survey.fields || []).map((tx, idx) => (
                <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:border-indigo-200 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-semibold text-slate-900">{tx.description}</p>
                      <p className="text-xs text-slate-500">{tx.date}</p>
                    </div>
                    <span className={`font-mono font-medium ${tx.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                      <select
                        className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-white"
                        value={answers[idx]?.category || ''}
                        onChange={(e) => setAnswers({ ...answers, [idx]: { ...answers[idx], category: e.target.value } })}
                      >
                        <option value="">Select Category...</option>
                        {(survey.categories || ['Personal Expense', 'Loan', 'Business Expense', 'Account Transfer']).map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                      <input
                        type="text"
                        className="w-full p-2 rounded-lg border border-slate-200 text-sm"
                        placeholder="Add details..."
                        value={answers[idx]?.notes || ''}
                        onChange={(e) => setAnswers({ ...answers, [idx]: { ...answers[idx], notes: e.target.value } })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {(survey.fields || []).map((f, i) => (
                <div key={i}>
                  <label className="block text-sm font-medium text-slate-900 mb-2">{f.label}</label>
                  {f.type === 'text' && <input type="text" className="w-full p-3 rounded-xl border border-slate-200" />}
                  {/* Add other types as needed */}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleSubmit}
            className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold text-lg hover:bg-indigo-700 shadow-lg hover:shadow-xl transition-all"
          >
            Submit Response
          </button>
        </div>
      </div>
    </div>
  );
}
