/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp,
  getDocs,
  getDocFromServer,
  limit,
  deleteField
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth, loginWithGoogle, logout } from './firebase';
import { 
  Utensils, 
  LayoutDashboard, 
  Plus, 
  Trash2, 
  Edit2,
  ShoppingCart, 
  User, 
  Lock, 
  LogOut, 
  ClipboardList,
  Clock,
  Table,
  CheckCircle2,
  ChefHat,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Sun,
  Moon,
  Menu,
  Download
} from 'lucide-react';
import { jsPDF } from 'jspdf';

// --- Smart Pricing Helper ---
export const getDynamicPriceInfo = (basePrice: number, categoryId: string, categories: Category[]) => {
  let finalPrice = basePrice;
  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6;
  const hour = new Date().getHours();
  // Happy hour: 4 PM - 6 PM
  const isHappyHour = hour >= 16 && hour < 18;
  
  let appliedDiscount = false;
  let appliedSurge = false;
  
  const category = categories.find(c => c.id === categoryId);
  const categoryName = category ? category.name.toLowerCase() : '';

  if (isHappyHour && (categoryName.includes('drink') || categoryName.includes('starter') || categoryName.includes('beverage') || categoryName.includes('snack'))) {
    finalPrice = finalPrice * 0.8; // 20% off during happy hour
    appliedDiscount = true;
  }

  if (isWeekend) {
    finalPrice = finalPrice * 1.05; // 5% weekend surge
    appliedSurge = true;
  }

  return { 
    price: Math.round(finalPrice), 
    discounted: appliedDiscount, 
    surged: appliedSurge,
    isHappyHour,
    isWeekend
  };
};

export const getSmartPrice = (basePrice: number, categoryId: string, categories: Category[]) => getDynamicPriceInfo(basePrice, categoryId, categories).price;

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // showNotification("Database error occurred. Please check console.", "error");
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  image: string; // Base64
  categoryId: string;
  isAvailable?: boolean;
  stockCount?: number;
  lowStockThreshold?: number;
}

interface Category {
  id: string;
  name: string;
  order?: number;
}

type OrderStatus = 'Pending' | 'Preparing' | 'Ready' | 'Delivered' | 'Cancelled';

interface Order {
  id: string;
  customerName: string;
  tableNumber: string;
  items: { name: string; price: number; quantity: number, notes?: string }[];
  totalPrice: number;
  timestamp: number;
  status: OrderStatus;
}

// --- Constants ---

const DEFAULT_ADMIN_PASSWORD = "7818066137@9258";
const STORAGE_KEYS = {
  MENU: 'hotel_management_menu',
  ORDERS: 'hotel_management_orders',
  CATEGORIES: 'hotel_management_categories',
  ADMIN_PASS: 'hotel_management_admin_pass',
  SECURITY_Q: 'hotel_management_security_q',
  SECURITY_A: 'hotel_management_security_a',
};

const playNotificationSound = () => {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
  
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
  gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
  
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  
  osc.start();
  osc.stop(ctx.currentTime + 0.5);
};

// --- Components ---

export default function App() {
  const [activeTab, setActiveTab] = useState<'user' | 'admin' | 'kitchen'>('user');
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);


  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [user, setUser] = useState<any>(null);

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user && user.email === "prashantgupta9258@gmail.com") {
        setIsAdminAuthenticated(true);
      } else {
        setIsAdminAuthenticated(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const isFirstLoad = useRef(true);

  // Firestore Listeners
  useEffect(() => {
    const qCategories = query(collection(db, 'categories'));
    const unsubscribeCategories = onSnapshot(qCategories, (snapshot) => {
      let cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
      // Default to custom order if available, otherwise alphabetical
      cats = cats.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) {
          return a.order - b.order;
        }
        return a.name.localeCompare(b.name);
      });
      setCategories(cats);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'categories'));

    const qMenu = query(collection(db, 'menu'), orderBy('name'));
    const unsubscribeMenu = onSnapshot(qMenu, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MenuItem));
      setMenu(items);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'menu'));

    const qOrders = query(collection(db, 'orders'), orderBy('timestamp', 'desc'), limit(200));
    const unsubscribeOrders = onSnapshot(qOrders, (snapshot) => {
      let hasNewOrder = false;
      if (!isFirstLoad.current) {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') hasNewOrder = true;
        });
      }
      
      const ords = snapshot.docs.map(doc => {
        const data = doc.data();
        let timestamp = Date.now();
        if (data.timestamp) {
          if (typeof data.timestamp.toDate === 'function') {
            timestamp = data.timestamp.toDate().getTime();
          } else if (typeof data.timestamp === 'number') {
            timestamp = data.timestamp;
          } else if (typeof data.timestamp === 'string') {
            timestamp = new Date(data.timestamp).getTime();
            if (isNaN(timestamp)) timestamp = Date.now();
          } else if (typeof data.timestamp === 'object' && data.timestamp.seconds) {
            timestamp = data.timestamp.seconds * 1000;
          }
        }
        return { 
          id: doc.id, 
          ...data,
          timestamp 
        } as Order;
      });
      setOrders(ords);

      if (hasNewOrder) {
        if (activeTab === 'admin' || activeTab === 'kitchen') {
          playNotificationSound();
        }
      }
      isFirstLoad.current = false;
    }, (error) => handleFirestoreError(error, OperationType.GET, 'orders'));

    return () => {
      unsubscribeCategories();
      unsubscribeMenu();
      unsubscribeOrders();
    };
  }, [activeTab]);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: newStatus });
      showNotification(`Order status updated to ${newStatus}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-24">
      {/* Header / Navigation */}
      <header className="flex justify-between items-center mb-12 glass-panel p-4 sticky top-4 z-50">
        <div className="flex items-center gap-2">
          <ChefHat className="w-8 h-8 neon-text-cyan shrink-0" />
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">
            NEON<span className="neon-text-cyan">GLASS</span> HOTEL
          </h1>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-xl text-theme-text/60 hover:text-theme-text hover:bg-glass transition-all"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          
          <nav className="hidden sm:flex gap-2">
            <button
              onClick={() => setActiveTab('user')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 ${
                activeTab === 'user' 
                  ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50 neon-shadow-cyan' 
                  : 'hover:bg-glass text-theme-text/60'
              }`}
            >
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">User View</span>
            </button>
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 ${
                activeTab === 'admin' 
                  ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/50 neon-shadow-purple' 
                  : 'hover:bg-glass text-theme-text/60'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="text-sm font-medium">Admin</span>
            </button>
          </nav>

          <div className="sm:hidden relative">
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 rounded-xl text-theme-text hover:bg-glass transition-all"
            >
              <Menu className="w-6 h-6" />
            </button>
            
            <AnimatePresence>
              {isMobileMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-48 glass-panel p-2 flex flex-col gap-1 shadow-2xl"
                >
                  <button
                    onClick={() => { setActiveTab('user'); setIsMobileMenuOpen(false); }}
                    className={`flex items-center gap-2 p-3 rounded-lg transition-all ${
                      activeTab === 'user' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-theme-text/80 hover:bg-glass'
                    }`}
                  >
                    <User className="w-4 h-4" />
                    <span className="text-sm font-medium">User View</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('admin'); setIsMobileMenuOpen(false); }}
                    className={`flex items-center gap-2 p-3 rounded-lg transition-all ${
                      activeTab === 'admin' ? 'bg-neon-purple/20 text-neon-purple' : 'text-theme-text/80 hover:bg-glass'
                    }`}
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span className="text-sm font-medium">Admin Dashboard</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main>
        <AnimatePresence mode="wait">
          {activeTab === 'user' && (
            <motion.div
              key="user"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <UserView 
                menu={menu} 
                categories={categories}
                orders={orders} 
                onOrderSubmit={async (order) => {
                  try {
                    // Update stock counts
                    order.items.forEach(async (orderItem) => {
                      const menuItem = menu.find(m => m.name === orderItem.name);
                      if (menuItem && menuItem.stockCount !== undefined) {
                        const newStock = Math.max(0, menuItem.stockCount - orderItem.quantity);
                        const updates: any = { stockCount: newStock };
                        // Automatically mark out of stock if newStock is 0
                        if (newStock === 0) updates.isAvailable = false;
                        await updateDoc(doc(db, 'menu', menuItem.id), updates);
                      }
                    });

                    await addDoc(collection(db, 'orders'), { ...order, timestamp: serverTimestamp() });
                    showNotification("Order placed successfully!");
                  } catch (error: any) {
                    console.error("Order error", error);
                    showNotification(`Failed to place order: ${error.message}`, "error");
                  }
                }} 
                onOrderCancel={async (orderId) => {
                  try {
                    await updateDoc(doc(db, 'orders', orderId), { status: 'Cancelled' });
                    showNotification("Order cancelled successfully!");
                  } catch (error: any) {
                    console.error("Cancel error", error);
                    showNotification(`Failed to cancel: ${error.message}`, "error");
                  }
                }}
                onOrderUpdate={async (updatedOrder) => {
                  try {
                    const { id, ...data } = updatedOrder;
                    await updateDoc(doc(db, 'orders', id), data);
                    showNotification("Order updated successfully!");
                  } catch (error: any) {
                    console.error("Update error", error);
                    showNotification(`Failed to update order: ${error.message}`, "error");
                  }
                }}
                showNotification={showNotification}
              />
            </motion.div>
          )}

          {activeTab === 'admin' && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {!isAdminAuthenticated ? (
                <AdminLogin onLogin={() => setIsAdminAuthenticated(true)} showNotification={showNotification} />
              ) : (
                <AdminDashboard 
                  menu={menu} 
                  categories={categories}
                  orders={orders} 
                  onUpdateMenu={async (newMenu) => {
                    // Handled by individual operations in AdminDashboard
                  }} 
                  onUpdateCategories={async (newCategories) => {
                    // Handled by individual operations in AdminDashboard
                  }}
                  onUpdateOrderStatus={updateOrderStatus}
                  onClearOrders={async () => {
                    try {
                      const snapshot = await getDocs(collection(db, 'orders'));
                      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
                      await Promise.all(deletePromises);
                      showNotification("All orders cleared!");
                    } catch (error) {
                      handleFirestoreError(error, OperationType.DELETE, 'orders');
                    }
                  }}
                  onLogout={async () => {
                    await logout();
                    setIsAdminAuthenticated(false);
                  }}
                  showNotification={showNotification}
                />
              )}
            </motion.div>
          )}

          {activeTab === 'kitchen' && (
            <motion.div
              key="kitchen"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {!isAdminAuthenticated ? (
                <AdminLogin onLogin={() => setIsAdminAuthenticated(true)} showNotification={showNotification} />
              ) : (
                <KitchenView orders={orders} onUpdateOrderStatus={updateOrderStatus} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-full glass-panel flex items-center gap-3 border-l-4 ${
              notification.type === 'success' ? 'border-l-neon-lime' : 'border-l-red-500'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-neon-lime" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-500" />
            )}
            <span className="text-sm font-medium">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-Components ---

function ConfirmModal({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onCancel,
  confirmText = "Confirm",
  confirmColor = "bg-red-500"
}: { 
  isOpen: boolean, 
  title: string, 
  message: string, 
  onConfirm: () => void, 
  onCancel: () => void,
  confirmText?: string,
  confirmColor?: string
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-panel p-6 max-w-sm w-full space-y-6 border border-white/20"
      >
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-theme-text">{title}</h3>
          <p className="text-theme-text/60 text-sm">{message}</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-xl bg-glass border border-glass text-theme-text font-bold hover:bg-glass-hover transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={() => {
              onConfirm();
              onCancel();
            }}
            className={`flex-1 px-4 py-2 rounded-xl border font-bold hover:scale-[1.02] active:scale-[0.98] transition-all ${
              confirmColor === 'bg-red-500' 
                ? 'bg-red-500/20 text-red-500 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:bg-red-500/30' 
                : `${confirmColor} text-theme-text`
            }`}
          >
            {confirmText}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function UserView({ menu, categories, orders, trendingItemId, onOrderSubmit, onOrderCancel, onOrderUpdate, showNotification }: { 
  menu: MenuItem[], 
  categories: Category[],
  orders: Order[], 
  trendingItemId?: string | null,
  onOrderSubmit: (order: Order) => void,
  onOrderCancel: (orderId: string) => void,
  onOrderUpdate: (order: Order) => void,
  showNotification: (msg: string, type?: 'success' | 'error') => void
}) {
  const [customerName, setCustomerName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [searchName, setSearchName] = useState('');
  const [searchTable, setSearchTable] = useState('');
  const [foundOrders, setFoundOrders] = useState<Order[]>([]);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string, discountPct: number, discountFlat: number } | null>(null);
  const [couponCode, setCouponCode] = useState('');

  // Keep foundOrders in sync with orders prop
  useEffect(() => {
    if (searchName && searchTable) {
      const matchingOrders = orders.filter((o: Order) => 
        o.customerName.toLowerCase() === searchName.trim().toLowerCase() && 
        o.tableNumber === searchTable.trim()
      );
      setFoundOrders(matchingOrders.sort((a, b) => b.timestamp - a.timestamp));
    }
  }, [orders, searchName, searchTable]);

  const updateQuantity = (itemId: string, delta: number) => {
    setSelectedItems(prev => {
      const newItems = { ...prev };
      const currentQty = newItems[itemId] || 0;
      const nextQty = currentQty + delta;
      
      if (nextQty <= 0) {
        delete newItems[itemId];
        setItemNotes(prevNotes => {
          const newNotes = { ...prevNotes };
          delete newNotes[itemId];
          return newNotes;
        });
      } else {
        newItems[itemId] = nextQty;
      }
      return newItems;
    });
  };

  const applyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (code === 'FIRST50') {
      setAppliedCoupon({ code, discountPct: 0, discountFlat: 50 });
      showNotification('Coupon FIRST50 applied! ₹50 off.');
    } else if (code === 'WELCOME') {
      setAppliedCoupon({ code, discountPct: 10, discountFlat: 0 });
      showNotification('Coupon WELCOME applied! 10% off.');
    } else {
      showNotification('Invalid coupon code.', 'error');
    }
    setCouponCode('');
  };

  const removeCoupon = () => setAppliedCoupon(null);

  const subTotalPrice = Object.entries(selectedItems).reduce((sum, [id, qty]) => {
    const item = menu.find(m => m.id === id);
    if (!item) return sum;
    const price = getSmartPrice(item.price, item.categoryId, categories);
    return sum + (price * (qty as number));
  }, 0);

  let discountAmount = 0;
  if (appliedCoupon) {
    if (appliedCoupon.discountFlat > 0) discountAmount += appliedCoupon.discountFlat;
    if (appliedCoupon.discountPct > 0) discountAmount += (subTotalPrice * (appliedCoupon.discountPct / 100));
  }
  // Bulk Order Discount
  if (subTotalPrice > 2000) {
    discountAmount += subTotalPrice * 0.05;
  }
  const totalPrice = Math.max(0, subTotalPrice - discountAmount);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const nameToSubmit = customerName.trim();
    const tableToSubmit = tableNumber.trim();
    
    if (!nameToSubmit || !tableToSubmit || Object.keys(selectedItems).length === 0) {
      showNotification("Please fill all details and select at least one item.", "error");
      return;
    }

    const hasUnavailableItems = Object.entries(selectedItems).some(([id, qty]) => {
      const item = menu.find(m => m.id === id);
      return item && item.isAvailable === false && (qty as number) > 0;
    });

    if (hasUnavailableItems) {
      showNotification("Some selected items are currently out of stock. Please remove them to place order.", "error");
      return;
    }

    const orderData = {
      customerName: nameToSubmit,
      tableNumber: tableToSubmit,
      items: Object.entries(selectedItems).map(([id, qty]) => {
        const item = menu.find(m => m.id === id);
        if (!item) return null;
        const price = getSmartPrice(item.price, item.categoryId, categories);
        return { name: item.name, price: price, quantity: qty as number, notes: itemNotes[id] || '' };
      }).filter(Boolean),
      totalPrice,
      timestamp: Date.now(),
      status: 'Pending' as const
    };

    if (editingOrderId) {
      onOrderUpdate({ ...orderData, id: editingOrderId } as Order);
      setEditingOrderId(null);
    } else {
      onOrderSubmit(orderData as Order);
    }
    
    // Reset form
    setCustomerName('');
    setTableNumber('');
    setSelectedItems({});
    setItemNotes({});
  };

  const handleEditOrder = (order: Order) => {
    if (order.status !== 'Pending') {
      showNotification("Only pending orders can be edited.", "error");
      return;
    }
    setCustomerName(order.customerName);
    setTableNumber(order.tableNumber);
    const items: Record<string, number> = {};
    const notes: Record<string, string> = {};
    order.items.forEach(item => {
      const menuItem = menu.find(m => m.name === item.name);
      if (menuItem) {
        items[menuItem.id] = item.quantity;
        if (item.notes) {
          notes[menuItem.id] = item.notes;
        }
      }
    });
    setSelectedItems(items);
    setItemNotes(notes);
    setEditingOrderId(order.id);
    // Scroll to form
    const formElement = document.getElementById('order-form');
    if (formElement) {
      formElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleCancelOrder = (orderId: string) => {
    setConfirmCancelId(orderId);
  };

  const handleCheckStatus = (e: React.FormEvent) => {
    e.preventDefault();
    const matchingOrders = orders.filter((o: Order) => 
      o.customerName.toLowerCase() === searchName.trim().toLowerCase() && 
      o.tableNumber === searchTable.trim()
    );
    if (matchingOrders.length > 0) {
      setFoundOrders(matchingOrders.sort((a, b) => b.timestamp - a.timestamp));
    } else {
      showNotification("No orders found with these details.", "error");
      setFoundOrders([]);
    }
  };

  const menuContent = React.useMemo(() => {
    return (
      <section className="glass-panel p-6 space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2 neon-text-cyan">
          <Utensils className="w-5 h-5" />
          Menu
        </h2>
        
        {menu.length === 0 ? (
          <div className="text-center py-12 text-theme-text/30 italic">
            Menu is currently empty. Please wait for admin to add items.
          </div>
        ) : (
          <div className="space-y-12">
            {categories.map(category => {
              const categoryItems = menu.filter(item => item.categoryId === category.id);
              if (categoryItems.length === 0) return null;
              
              return (
                <div key={category.id} className="space-y-4">
                  <h3 className="text-lg font-bold text-theme-text/60 border-b border-glass pb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-white/20"></span>
                    {category.name}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {categoryItems.map((item) => {
                      const outOfStock = item.isAvailable === false;
                      return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-4 p-3 rounded-2xl border transition-all duration-300 ${
                          !outOfStock ? 'sm:hover:scale-[1.02]' : ''
                        } ${
                          selectedItems[item.id] 
                            ? 'bg-neon-cyan/10 border-neon-cyan/40 neon-shadow-cyan' 
                            : 'bg-glass border-glass hover:border-white/20'
                        } ${outOfStock ? 'opacity-50 grayscale' : ''}`}
                      >
                        <div className="relative">
                          <img 
                            src={item.image} 
                            alt={item.name} 
                            className="w-16 h-16 rounded-xl object-cover border border-glass"
                            referrerPolicy="no-referrer"
                          />
                          {outOfStock && (
                            <div className="absolute inset-0 bg-black/60 rounded-xl flex flex-col justify-center items-center backdrop-blur-[2px]">
                              <span className="text-[10px] font-bold text-red-500 border border-red-500 px-1.5 py-0.5 rounded shadow-[0_0_10px_rgba(239,68,68,0.5)] uppercase bg-black/80">Sold Out</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium text-theme-text/90 flex flex-wrap items-center gap-2">
                            {item.name}
                            {item.id === trendingItemId && (
                              <span className="text-[10px] uppercase font-bold bg-orange-500 text-white px-1.5 py-[1px] rounded-sm shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse">🔥 Trending</span>
                            )}
                          </h3>
                          <div className="flex items-center gap-2">
                            <p className="text-neon-cyan font-bold">₹{getSmartPrice(item.price, item.categoryId, categories)}</p>
                            {getDynamicPriceInfo(item.price, item.categoryId, categories).discounted && <span className="text-xs line-through opacity-50">₹{item.price}</span>}
                            {getDynamicPriceInfo(item.price, item.categoryId, categories).surged && <span className="text-[10px] bg-red-500/20 text-red-500 px-1 rounded">Surge</span>}
                          </div>
                        </div>
                        
                        {(!outOfStock || (selectedItems[item.id] || 0) > 0) && (
                        <div className="flex items-center gap-2 bg-black/20 rounded-lg p-1">
                          <button 
                            onClick={() => updateQuantity(item.id, -1)}
                            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-glass-hover transition-all"
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-bold text-sm">
                            {selectedItems[item.id] || 0}
                          </span>
                          {!outOfStock ? (
                            <button 
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-glass-hover transition-all text-neon-cyan"
                            >
                              +
                            </button>
                          ) : (
                            <div className="w-8 h-8"></div>
                          )}
                        </div>
                        )}
                      </div>
                    )})}
                  </div>
                </div>
              );
            })}
            
            {/* Items without category */}
            {menu.filter(item => !item.categoryId || !categories.find(c => c.id === item.categoryId)).length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-theme-text/60 border-b border-glass pb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-white/20"></span>
                  Other Items
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {menu.filter(item => !item.categoryId || !categories.find(c => c.id === item.categoryId)).map((item) => {
                    const outOfStock = item.isAvailable === false;
                    return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-4 p-3 rounded-2xl border transition-all duration-300 ${
                        !outOfStock ? 'sm:hover:scale-[1.02]' : ''
                      } ${
                        selectedItems[item.id] 
                          ? 'bg-neon-cyan/10 border-neon-cyan/40 neon-shadow-cyan' 
                          : 'bg-glass border-glass hover:border-white/20'
                      } ${outOfStock ? 'opacity-50 grayscale' : ''}`}
                    >
                      <div className="relative">
                        <img 
                          src={item.image} 
                          alt={item.name} 
                          className="w-16 h-16 rounded-xl object-cover border border-glass"
                          referrerPolicy="no-referrer"
                        />
                        {outOfStock && (
                          <div className="absolute inset-0 bg-black/60 rounded-xl flex flex-col justify-center items-center backdrop-blur-[2px]">
                            <span className="text-[10px] font-bold text-red-500 border border-red-500 px-1.5 py-0.5 rounded shadow-[0_0_10px_rgba(239,68,68,0.5)] uppercase bg-black/80">Sold Out</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-theme-text/90 flex flex-wrap items-center gap-2">
                          {item.name}
                          {item.id === trendingItemId && (
                            <span className="text-[10px] uppercase font-bold bg-orange-500 text-white px-1.5 py-[1px] rounded-sm shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse">🔥 Trending</span>
                          )}
                        </h3>
                        <div className="flex items-center gap-2">
                          <p className="text-neon-cyan font-bold">₹{getSmartPrice(item.price, item.categoryId, categories)}</p>
                          {getDynamicPriceInfo(item.price, item.categoryId, categories).discounted && <span className="text-xs line-through opacity-50">₹{item.price}</span>}
                          {getDynamicPriceInfo(item.price, item.categoryId, categories).surged && <span className="text-[10px] bg-red-500/20 text-red-500 px-1 rounded">Surge</span>}
                        </div>
                      </div>
                      
                      {(!outOfStock || (selectedItems[item.id] || 0) > 0) && (
                      <div className="flex items-center gap-2 bg-black/20 rounded-lg p-1">
                        <button 
                          onClick={() => updateQuantity(item.id, -1)}
                          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-glass-hover transition-all"
                        >
                          -
                        </button>
                        <span className="w-6 text-center font-bold text-sm">
                          {selectedItems[item.id] || 0}
                        </span>
                        {!outOfStock ? (
                          <button 
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-glass-hover transition-all text-neon-cyan"
                          >
                            +
                          </button>
                        ) : (
                          <div className="w-8 h-8"></div>
                        )}
                      </div>
                      )}
                    </div>
                  )})}
                </div>
              </div>
            )}
          </div>
        )
      }
      </section>
    );
  }, [categories, menu, selectedItems]);

  return (
    <div className="space-y-8">
      <ConfirmModal 
        isOpen={!!confirmCancelId}
        title="Cancel Order"
        message="Are you sure you want to cancel this order?"
        onConfirm={() => {
          if (confirmCancelId) {
            onOrderCancel(confirmCancelId);
          }
        }}
        onCancel={() => setConfirmCancelId(null)}
      />
      {/* Status Check Section */}
      <section className="glass-panel p-6 space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2 neon-text-cyan">
          <Clock className="w-5 h-5" />
          Order History & Tracking
        </h2>
        <form onSubmit={handleCheckStatus} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Your Name</label>
            <input
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="Enter name"
              className="w-full bg-glass border border-glass rounded-xl px-4 py-2 focus:outline-none focus:border-neon-cyan/50 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Table No.</label>
            <input
              type="text"
              value={searchTable}
              onChange={(e) => setSearchTable(e.target.value)}
              placeholder="Table No."
              className="w-full bg-glass border border-glass rounded-xl px-4 py-2 focus:outline-none focus:border-neon-cyan/50 transition-all"
            />
          </div>
          <button
            type="submit"
            className="bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50 px-4 py-2 rounded-xl font-bold hover:bg-neon-cyan/30 transition-all"
          >
            Check History
          </button>
        </form>

        <AnimatePresence>
          {foundOrders.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 mt-4"
            >
              <h3 className="text-sm font-bold text-theme-text uppercase tracking-widest">Your Orders</h3>
              {foundOrders.map(order => (
                <div key={order.id} className="p-4 bg-glass rounded-xl border border-glass space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <p className="text-xs text-theme-text/40 uppercase">Status</p>
                      <p className={`text-lg font-bold ${order.status === 'Cancelled' ? 'text-red-500' : 'neon-text-cyan'}`}>{order.status}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center justify-start sm:justify-end w-full sm:w-auto">
                      {(order.status === 'Pending' || order.status === 'Preparing') && (
                        <>
                          <button
                            onClick={() => handleEditOrder(order)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 transition-all text-sm font-bold"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleCancelOrder(order.id)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 transition-all text-sm font-bold"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Cancel
                          </button>
                        </>
                      )}
                      {/* Order ID removed as requested */}
                    </div>
                  </div>
                  
                  {/* Order Items Summary */}
                  <div className="pt-3 border-t border-glass">
                    <div className="space-y-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex flex-col text-sm border-b border-glass-subtle pb-1">
                          <div className="flex justify-between">
                            <span className="text-white/80">{item.quantity}x {item.name}</span>
                            <span className="text-theme-text/60">₹{item.price * item.quantity}</span>
                          </div>
                          {item.notes && <span className="text-xs text-orange-300 italic opacity-80 pl-4 mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">&quot;{item.notes}&quot;</span>}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center mt-3 pt-3 border-t border-glass-subtle">
                      <span className="text-sm font-bold text-theme-text/60">Total</span>
                      <span className="font-bold text-neon-cyan">₹{order.totalPrice}</span>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {menuContent}

      <section id="order-form" className="glass-panel p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold flex items-center gap-2 neon-text-cyan">
            <ClipboardList className="w-5 h-5" />
            {editingOrderId ? 'Edit Order' : 'Customer Details'}
          </h2>
          {editingOrderId && (
            <button 
              onClick={() => {
                setEditingOrderId(null);
                setCustomerName('');
                setTableNumber('');
                setSelectedItems({});
              }}
              className="text-xs text-theme-text/40 hover:text-theme-text transition-all underline"
            >
              Cancel Editing
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Customer Name</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter your name"
              className="w-full bg-glass border border-glass rounded-xl px-4 py-3 focus:outline-none focus:border-neon-cyan/50 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Table Number</label>
            <input
              type="text"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              placeholder="e.g. 05"
              className="w-full bg-glass border border-glass rounded-xl px-4 py-3 focus:outline-none focus:border-neon-cyan/50 transition-all"
            />
          </div>
        </div>
        {Object.keys(selectedItems).length > 0 && (
          <div className="space-y-3 mt-4">
            <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Item Notes</label>
            <div className="grid grid-cols-1 gap-3">
              {Object.entries(selectedItems).map(([id, qty]) => {
                const item = menu.find(m => m.id === id);
                if (!item) return null;
                return (
                  <div key={id} className="flex flex-col sm:flex-row gap-2 bg-glass border border-glass rounded-xl p-3">
                    <div className="flex-1">
                      <p className="font-semibold text-theme-text/90">{item.name} <span className="text-neon-cyan text-xs ml-2">x{qty}</span></p>
                    </div>
                    <div className="flex-[2] w-full">
                      <input
                        type="text"
                        value={itemNotes[id] || ''}
                        onChange={(e) => setItemNotes(prev => ({ ...prev, [id]: e.target.value }))}
                        placeholder="Add note (e.g. extra spicy, no onions)"
                        className="w-full bg-black/50 border border-glass-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neon-cyan/50 transition-all text-theme-text/90"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="mt-6 border-t border-glass pt-6 flex flex-col sm:flex-row gap-4 items-end">
              <div className="flex-1 w-full space-y-2">
                <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Apply Coupon</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="e.g. WELCOME"
                    disabled={appliedCoupon !== null}
                    className="w-full bg-glass border border-glass rounded-xl px-4 py-3 focus:outline-none focus:border-neon-cyan/50 transition-all disabled:opacity-50"
                  />
                  {!appliedCoupon ? (
                    <button 
                      onClick={applyCoupon}
                      className="bg-neon-purple text-white px-6 py-3 rounded-xl font-bold whitespace-nowrap hover:bg-neon-purple/80 transition-all"
                    >
                      Apply
                    </button>
                  ) : (
                    <button 
                      onClick={removeCoupon}
                      className="bg-red-500/20 text-red-500 border border-red-500/50 px-6 py-3 rounded-xl font-bold whitespace-nowrap hover:bg-red-500/30 transition-all"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {appliedCoupon && (
                  <p className="text-sm text-neon-cyan mt-2">
                    ✅ Coupon <span className="font-bold">{appliedCoupon.code}</span> applied successfully!
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Sticky Footer for Order Summary - Using Portal to avoid transform issues */}
      {createPortal(
        <AnimatePresence>
          {Object.keys(selectedItems).length > 0 && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-0 left-0 right-0 px-4 py-4 landscape:py-2 order-summary-panel backdrop-blur-md border-t z-[50]"
              style={{ 
                paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
                marginBottom: 'env(safe-area-inset-bottom)'
              }}
            >
              <div className="max-w-4xl mx-auto flex items-center justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] landscape:text-[9px] uppercase tracking-[0.2em] text-theme-text/40 font-black mb-1">Total Amount</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-neon-cyan text-sm font-bold">₹</span>
                    <span className="text-2xl sm:text-3xl landscape:text-xl font-black text-theme-text tracking-tighter">
                      {totalPrice}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleSubmit}
                  className="bg-neon-cyan text-black px-8 py-4 landscape:py-2.5 rounded-2xl font-black flex items-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(0,255,255,0.3)] whitespace-nowrap group"
                >
                  <ShoppingCart className="w-6 h-6 landscape:w-5 landscape:h-5 group-hover:rotate-12 transition-transform" />
                  <span className="text-base landscape:text-sm uppercase tracking-tight">
                    {editingOrderId ? 'Update Order' : 'Confirm Order'}
                  </span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

function AdminLogin({ onLogin, showNotification }: { onLogin: () => void, showNotification: (msg: string, type?: 'success' | 'error') => void }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const result = await loginWithGoogle();
      if (result.user.email === "prashantgupta9258@gmail.com") {
        onLogin();
        showNotification("Welcome back, Admin!");
      } else {
        await logout();
        showNotification("Unauthorized access. Admin only.", "error");
      }
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        // Silently handle cancelled login so it doesn't log as a crash
        showNotification("Login cancelled.", "error");
      } else if (error.code === 'auth/unauthorized-domain') {
         showNotification("Error: Please add your Netlify domain to Firebase Console -> Authentication -> Settings -> Authorized domains", "error");
         console.error("Unauthorized domain error:", error);
      } else {
        console.error(error);
        showNotification(`Login failed: ${error.message || 'Please try again.'}`, "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center p-4 py-20">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-panel p-8 max-w-md w-full space-y-8 border border-white/20 text-center"
      >
        <div className="space-y-2">
          <div className="w-16 h-16 bg-neon-purple/20 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-neon-purple/50">
            <Lock className="w-8 h-8 text-neon-purple" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Admin Access</h2>
          <p className="text-theme-text/40">Please sign in with your authorized Google account.</p>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full bg-white text-black py-4 rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-white/90 transition-all disabled:opacity-50"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign in with Google
            </>
          )}
        </button>
      </motion.div>
    </div>
  );
}

function KitchenView({ orders, onUpdateOrderStatus }: { orders: Order[], onUpdateOrderStatus: (id: string, status: OrderStatus) => void }) {
  const activeOrders = orders.filter(o => o.status === 'Pending' || o.status === 'Preparing').sort((a,b) => a.timestamp - b.timestamp);

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-black uppercase tracking-widest text-theme-text mb-8">Kitchen Display System</h2>
      
      {activeOrders.length === 0 ? (
        <div className="glass-panel p-16 text-center text-theme-text/40 text-xl font-medium">
          No active orders. Kitchen is clear!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {activeOrders.map(order => (
            <div key={order.id} className={`glass-panel p-6 border-l-8 ${order.status === 'Pending' ? 'border-l-orange-500' : 'border-l-yellow-500'} flex flex-col h-[500px]`}>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-sm font-bold text-theme-text/50 uppercase tracking-wider mb-1">Table {order.tableNumber}</div>
                  <div className="text-2xl font-black text-theme-text">{order.customerName}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-theme-text/40">{new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  <div className={`text-lg font-bold mt-1 ${order.status === 'Pending' ? 'text-orange-500 animate-pulse' : 'text-yellow-500'}`}>{order.status}</div>
                </div>
              </div>
              
              <div className="flex-1 bg-black/20 rounded-xl p-4 mb-6 overflow-y-auto">
                <ul className="space-y-4">
                  {order.items.map((item, idx) => (
                    <li key={idx} className="flex flex-col border-b border-white/5 pb-3 last:border-0 last:pb-0">
                      <div className="flex justify-between items-start text-xl font-bold text-white/90">
                        <span className="flex items-start gap-3">
                          <span className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-lg text-lg flex-shrink-0">{item.quantity}</span> 
                          <span className="mt-0.5">{item.name}</span>
                        </span>
                      </div>
                      {item.notes && <div className="text-orange-300 text-base italic font-medium mt-2 uppercase tracking-tight ml-11">** {item.notes} **</div>}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-3 mt-auto flex-shrink-0">
                {order.status === 'Pending' && (
                  <button 
                    onClick={() => onUpdateOrderStatus(order.id, 'Preparing')}
                    className="flex-1 py-4 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-500 border border-yellow-500/50 rounded-xl font-bold uppercase tracking-wider transition-all"
                  >
                    Start Prep
                  </button>
                )}
                {(order.status === 'Pending' || order.status === 'Preparing') && (
                  <button 
                    onClick={() => onUpdateOrderStatus(order.id, 'Ready')}
                    className="flex-1 py-4 bg-green-500 hover:bg-green-400 text-black rounded-xl font-black text-lg uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(34,197,94,0.4)]"
                  >
                    Mark Ready
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminDashboard({ 
  menu, 
  categories,
  orders, 
  onUpdateMenu, 
  onUpdateCategories,
  onUpdateOrderStatus,
  onClearOrders,
  onLogout,
  showNotification
}: { 
  menu: MenuItem[], 
  categories: Category[],
  orders: Order[], 
  onUpdateMenu: (menu: MenuItem[]) => void,
  onUpdateCategories: (categories: Category[]) => void,
  onUpdateOrderStatus: (id: string, status: OrderStatus) => Promise<void>,
  onClearOrders: () => void,
  onLogout: () => void,
  showNotification: (msg: string, type?: 'success' | 'error') => void
}) {
  const [view, setView] = useState<'orders' | 'menu'>('orders');
  
  // Menu form state
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemImage, setNewItemImage] = useState<string | null>(null);
  const [newItemCategory, setNewItemCategory] = useState<string>('');
  const [newItemStock, setNewItemStock] = useState('');
  const [newItemLowStockThreshold, setNewItemLowStockThreshold] = useState('');
  const [isDishModalOpen, setIsDishModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isSubmittingMenu, setIsSubmittingMenu] = useState(false);
  const [isSubmittingCategory, setIsSubmittingCategory] = useState(false);
  
  // Search and filter state
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [menuFilterCategory, setMenuFilterCategory] = useState('All');

  // Category management state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  
  // Order search and filters
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<OrderStatus | 'All'>('All');
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<Order | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [confirmStatusChange, setConfirmStatusChange] = useState<{ id: string, newStatus: OrderStatus } | null>(null);

  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);

  const generateInvoice = (order: Order) => {
    const doc = new jsPDF();
    doc.setFontSize(22);
    doc.text("HOTEL INVOICE", 105, 20, { align: "center" });
    
    doc.setFontSize(12);
    doc.text(`Order ID: #${order.id.substring(0, 6)}`, 20, 40);
    doc.text(`Customer: ${order.customerName}`, 20, 48);
    doc.text(`Table: ${order.tableNumber}`, 20, 56);
    doc.text(`Date: ${new Date(order.timestamp).toLocaleString()}`, 20, 64);
    
    doc.line(20, 70, 190, 70);
    
    let y = 80;
    doc.setFontSize(14);
    doc.text("Items", 20, y);
    doc.text("Qty", 120, y);
    doc.text("Price", 160, y);
    
    doc.setFontSize(12);
    y += 10;
    order.items.forEach(item => {
      doc.text(item.name, 20, y);
      doc.text(item.quantity.toString(), 120, y);
      doc.text(`Rs. ${item.price * item.quantity}`, 160, y);
      y += 8;
    });
    
    doc.line(20, y+2, 190, y+2);
    y += 10;
    doc.setFontSize(16);
    doc.text(`Total: Rs. ${order.totalPrice}`, 140, y);
    
    doc.save(`Invoice_${order.customerName}_${order.id.substring(0,6)}.pdf`);
    showNotification("Invoice PDF generated successfully!");
  };

  const generateDailyReport = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaysOrders = orders.filter(o => o.timestamp >= today.getTime());
    
    // Stats
    const totalOrders = todaysOrders.length;
    const completedOrders = todaysOrders.filter(o => o.status === 'Delivered').length;
    const totalRevenue = todaysOrders.filter(o => o.status === 'Delivered').reduce((sum, o) => sum + o.totalPrice, 0);
    
    const doc = new jsPDF();
    doc.setFontSize(22);
    doc.text("DAILY HARVEST REPORT", 105, 20, { align: "center" });
    
    doc.setFontSize(14);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 40);
    
    doc.setFontSize(12);
    doc.text(`Total Orders Received: ${totalOrders}`, 20, 50);
    doc.text(`Total Orders Completed: ${completedOrders}`, 20, 58);
    doc.text(`Total Revenue: Rs. ${totalRevenue}`, 20, 66);
    
    doc.line(20, 75, 190, 75);
    
    // Top selling
    const itemSales: Record<string, number> = {};
    todaysOrders.filter(o => o.status !== 'Cancelled').forEach(o => {
      o.items.forEach(item => {
        itemSales[item.name] = (itemSales[item.name] || 0) + item.quantity;
      });
    });
    
    const sortedItems = Object.entries(itemSales).sort((a,b) => b[1] - a[1]).slice(0, 5);
    
    let y = 85;
    doc.setFontSize(16);
    doc.text("Top Selling Items Today", 20, y);
    y += 10;
    
    doc.setFontSize(12);
    sortedItems.forEach(([name, qty]) => {
      doc.text(`${name}`, 20, y);
      doc.text(`${qty} sold`, 150, y);
      y += 8;
    });
    
    doc.save(`DailyReport_${new Date().toISOString().split('T')[0]}.pdf`);
    showNotification("Daily Report generated successfully!");
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'Pending': return 'text-orange-400 bg-orange-400/10 border-orange-400/30 animate-pulse';
      case 'Preparing': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30 animate-pulse';
      case 'Ready': return 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/30 shadow-[0_0_10px_rgba(0,255,255,0.2)]';
      case 'Delivered': return 'text-green-400 bg-green-400/10 border-green-400/30';
      case 'Cancelled': return 'text-red-400 bg-red-400/10 border-red-400/30 line-through decoration-red-400/50';
      default: return 'text-neon-purple bg-neon-purple/10 border-neon-purple/30';
    }
  };

  const handleExportCSV = () => {
    const headers = ['Order ID', 'Customer Name', 'Table Number', 'Total Price', 'Status', 'Date', 'Items'];
    const rows = orders.map(order => {
      const itemsStr = order.items.map(i => `${i.quantity}x ${i.name}`).join('; ');
      return [
        order.id, 
        order.customerName, 
        order.tableNumber, 
        order.totalPrice, 
        order.status, 
        new Date(order.timestamp).toLocaleString(), 
        `"${itemsStr}"`
      ].join(',');
    });
    
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `orders_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5000000) { // 5MB limit
        showNotification("Image too large! Please use a smaller image (<5MB).", "error");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          const MAX_WIDTH = 600;
          const MAX_HEIGHT = 600;
          
          if (width > height) {
            if (width > MAX_WIDTH) {
              height = Math.round(height * (MAX_WIDTH / width));
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width = Math.round(width * (MAX_HEIGHT / height));
              height = MAX_HEIGHT;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6); // 60% quality jpeg
          
          // Check base64 string size roughly (1 char ~ 1 byte here for data uri representation)
          if (dataUrl.length > 1048400) {
            showNotification("Image is too complex, could not compress under 1MB.", "error");
          } else {
            setNewItemImage(dataUrl);
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName || !newItemPrice || !newItemImage) {
      showNotification("Please fill all fields and upload an image.", "error");
      return;
    }

    setIsSubmittingMenu(true);
    const itemData: any = {
      name: newItemName,
      price: parseFloat(newItemPrice),
      image: newItemImage,
      categoryId: newItemCategory,
    };
    
    setIsDishModalOpen(false);

    try {
      if (editingItem) {
        if (newItemStock !== '') {
          itemData.stockCount = parseInt(newItemStock, 10);
          if (newItemLowStockThreshold !== '') {
            itemData.lowStockThreshold = parseInt(newItemLowStockThreshold, 10);
          } else {
            itemData.lowStockThreshold = deleteField();
          }
        } else {
          itemData.stockCount = deleteField();
          itemData.lowStockThreshold = deleteField();
        }
        await updateDoc(doc(db, 'menu', editingItem.id), itemData);
        setEditingItem(null);
        showNotification("Item updated!");
      } else {
        itemData.isAvailable = true;
        if (newItemStock !== '') {
          itemData.stockCount = parseInt(newItemStock, 10);
          if (newItemLowStockThreshold !== '') {
            itemData.lowStockThreshold = parseInt(newItemLowStockThreshold, 10);
          }
        }
        
        await addDoc(collection(db, 'menu'), itemData);
        showNotification("Item added to menu!");
      }
      setNewItemName('');
      setNewItemPrice('');
      setNewItemImage(null);
      setNewItemCategory('');
      setNewItemStock('');
      setNewItemLowStockThreshold('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'menu');
      // Re-open if failed so user doesn't lose progress if they want to retry
      setIsDishModalOpen(true);
    } finally {
      setIsSubmittingMenu(false);
    }
  };

  const startEdit = (item: MenuItem) => {
    setEditingItem(item);
    setNewItemName(item.name);
    setNewItemPrice(item.price.toString());
    setNewItemImage(item.image);
    setNewItemCategory(item.categoryId || '');
    setNewItemStock(item.stockCount !== undefined ? item.stockCount.toString() : '');
    setNewItemLowStockThreshold(item.lowStockThreshold !== undefined ? item.lowStockThreshold.toString() : '');
    setIsDishModalOpen(true);
    setView('menu');
  };

  const toggleItemAvailability = async (item: MenuItem) => {
    try {
      const newAvailability = item.isAvailable === false ? true : false;
      await updateDoc(doc(db, 'menu', item.id), { isAvailable: newAvailability });
      showNotification(`Item marked as ${newAvailability ? 'Available' : 'Sold Out'}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `menu/${item.id}`);
    }
  };

  const trendingItemId = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentOrders = orders.filter(o => o.timestamp > sevenDaysAgo && o.status !== 'Cancelled');
    const counts: Record<string, number> = {};
    recentOrders.forEach(o => {
      o.items.forEach(item => {
        counts[item.name] = (counts[item.name] || 0) + item.quantity;
      });
    });
    let max = 0;
    let popularName = '';
    for (const [name, count] of Object.entries(counts)) {
      if (count > max) {
        max = count;
        popularName = name;
      }
    }
    const popularItem = menu.find(m => m.name === popularName);
    return popularItem ? popularItem.id : null;
  }, [orders, menu]);

  const peakHour = useMemo(() => {
    const hourCounts: Record<number, number> = {};
    orders.forEach(o => {
      if (o.status !== 'Cancelled') {
        const hour = new Date(o.timestamp).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
    });
    let max = 0;
    let peak = -1;
    for (const [hourStr, count] of Object.entries(hourCounts)) {
      if (count > max) {
        max = count;
        peak = parseInt(hourStr, 10);
      }
    }
    if (peak === -1) return null;
    const ampm = peak >= 12 ? 'PM' : 'AM';
    const hour12 = peak % 12 || 12;
    return `${hour12}:00 ${ampm} - ${hour12 === 11 ? '12:00 PM' : hour12 === 12 ? '1:00 PM' : `${Math.floor((peak + 1) % 12) || 12}:00 ${peak+1 >= 12 && peak+1 < 24 ? 'PM' : 'AM'}`}`;
  }, [orders]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        document.getElementById('menu-search-input')?.focus();
      }
      if (e.key === 'Escape') {
        setIsDishModalOpen(false);
        setIsCategoryModalOpen(false);
        setSelectedOrderDetails(null);
        setConfirmClear(false);
        setConfirmDeleteId(null);
        setConfirmDeleteCatId(null);
        setConfirmStatusChange(null);
      }
      if (e.ctrlKey && e.key === 's') {
        if (isDishModalOpen || isCategoryModalOpen) {
          e.preventDefault();
          if (isDishModalOpen) document.getElementById('add-dish-btn')?.click();
          else if (isCategoryModalOpen) document.getElementById('add-cat-btn')?.click();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDishModalOpen, isCategoryModalOpen]);

  const displayCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName) return;

    setIsSubmittingCategory(true);
    setIsCategoryModalOpen(false);

    try {
      if (editingCategory) {
        await updateDoc(doc(db, 'categories', editingCategory.id), { name: newCategoryName });
        setEditingCategory(null);
        showNotification("Category updated!");
      } else {
        await addDoc(collection(db, 'categories'), { name: newCategoryName, order: categories.length });
        showNotification("Category added!");
      }
      setNewCategoryName('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'categories');
      setIsCategoryModalOpen(true);
    } finally {
      setIsSubmittingCategory(false);
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'categories', id));
      showNotification("Category deleted!");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `categories/${id}`);
    }
  };

  return (
    <div className="space-y-8">
      <ConfirmModal
        isOpen={!!confirmStatusChange}
        title="Update Order Status"
        message={`Are you sure you want to change the status of this order to ${confirmStatusChange?.newStatus}?`}
        confirmText="Update Status"
        confirmColor={confirmStatusChange?.newStatus === 'Cancelled' ? 'bg-red-500' : 'bg-neon-cyan'}
        onConfirm={async () => {
          if (confirmStatusChange) {
            setUpdatingOrderId(confirmStatusChange.id);
            await onUpdateOrderStatus(confirmStatusChange.id, confirmStatusChange.newStatus);
            setUpdatingOrderId(null);
            setConfirmStatusChange(null);
          }
        }}
        onCancel={() => setConfirmStatusChange(null)}
      />
      {/* Admin Sub-Nav */}
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <div className="flex gap-2 p-1 glass-panel rounded-2xl flex-wrap">
          <button
            onClick={() => setView('orders')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2 ${
              view === 'orders' ? 'bg-neon-purple/20 text-neon-purple' : 'text-theme-text/40 hover:text-theme-text/60'
            }`}
          >
            <Clock className="w-4 h-4" />
            Orders ({orders.length})
          </button>
          <button
            onClick={() => setView('menu')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2 ${
              view === 'menu' ? 'bg-neon-purple/20 text-neon-purple' : 'text-theme-text/40 hover:text-theme-text/60'
            }`}
          >
            <Utensils className="w-4 h-4" />
            Manage Menu
          </button>
        </div>
        
        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-red-400 hover:bg-red-500/10 transition-all text-sm font-medium"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="glass-panel p-4 rounded-2xl">
          <div className="text-theme-text/40 text-xs font-bold uppercase tracking-wider mb-1">Total Orders</div>
          <div className="text-2xl font-black text-theme-text">{orders.length}</div>
        </div>
        <div className="glass-panel p-4 rounded-2xl">
          <div className="text-theme-text/40 text-xs font-bold uppercase tracking-wider mb-1">Total Revenue</div>
          <div className="text-2xl font-black text-neon-purple">₹{orders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + o.totalPrice, 0)}</div>
        </div>
        <div className="glass-panel p-4 rounded-2xl">
          <div className="text-theme-text/40 text-xs font-bold uppercase tracking-wider mb-1">7d Peak Hour</div>
          <div className="text-xl font-black text-theme-text leading-tight">{peakHour || 'N/A'}</div>
        </div>
        <div className="glass-panel p-4 rounded-2xl">
          <div className="text-theme-text/40 text-xs font-bold uppercase tracking-wider mb-1">7d Most Sold</div>
          <div className="text-xl font-black text-neon-cyan leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
            {trendingItemId ? menu.find(m => m.id === trendingItemId)?.name : 'N/A'}
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'orders' ? (
          <motion.div
            key="orders-list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold neon-text-purple flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Live Orders
              </h2>
              <div className="flex items-center gap-4">
                {orders.length > 0 && (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="text-xs text-red-400 hover:text-red-300 transition-all uppercase tracking-widest font-bold"
                  >
                    Clear All
                  </button>
                )}
                <span className="text-xs text-theme-text/30 uppercase tracking-widest">Auto-updating</span>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 mb-4">
              <input
                type="text"
                placeholder="Search by name, table, or item..."
                value={orderSearchQuery}
                onChange={(e) => setOrderSearchQuery(e.target.value)}
                className="bg-glass border border-glass rounded-xl px-4 py-2 focus:outline-none focus:border-neon-purple/50 transition-all text-sm w-full"
              />
            </div>
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div className="flex gap-2 flex-wrap pb-1 w-full max-w-full">
                {['All', 'Pending', 'Preparing', 'Ready', 'Delivered', 'Cancelled'].map(status => (
                  <button
                    key={status}
                    onClick={() => setOrderStatusFilter(status as any)}
                    className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      orderStatusFilter === status 
                        ? 'bg-neon-purple text-white neon-shadow-purple' 
                        : 'glass-panel text-theme-text/60 hover:text-theme-text/90'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                <button
                  onClick={generateDailyReport}
                  className="flex-1 sm:flex-none shrink-0 px-4 py-2 bg-neon-cyan/20 border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/30 rounded-xl text-sm font-medium transition-all flex items-center gap-2 justify-center"
                >
                  <Download className="w-4 h-4" />
                  PDF Report
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex-1 sm:flex-none shrink-0 px-4 py-2 bg-glass border border-glass hover:bg-glass-hover rounded-xl text-sm font-medium transition-all text-theme-text flex items-center gap-2 justify-center"
                >
                  <LogOut className="w-4 h-4 rotate-90" />
                  Export CSV
                </button>
              </div>
            </div>

            <ConfirmModal 
              isOpen={confirmClear}
              title="Clear All Orders"
              message="Are you sure you want to permanently clear all order history?"
              onConfirm={async () => {
                await onClearOrders();
                setConfirmClear(false);
              }}
              onCancel={() => setConfirmClear(false)}
            />

            {orders.length === 0 ? (
              <div className="glass-panel p-12 text-center text-theme-text/30 italic">
                No orders yet. They will appear here in real-time.
              </div>
            ) : (
              orders
                .filter((order) => {
                  const matchesSearch = order.customerName.toLowerCase().includes(orderSearchQuery.toLowerCase()) || 
                                        String(order.tableNumber).toLowerCase().includes(orderSearchQuery.toLowerCase()) ||
                                        order.items.some(i => i.name.toLowerCase().includes(orderSearchQuery.toLowerCase()));
                                        
                  const matchesStatus = orderStatusFilter === 'All' || order.status === orderStatusFilter;
                  
                  return matchesSearch && matchesStatus;
                })
                .map((order) => {
                  const isDelayed = Date.now() - order.timestamp > 30 * 60 * 1000 && ['Pending', 'Preparing', 'Ready'].includes(order.status);
                  
                  return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`glass-panel p-5 space-y-4 border-l-4 cursor-pointer hover:bg-white-[0.02] transition-colors ${
                    isDelayed ? 'border-l-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse' :
                    order.status === 'Pending' ? 'border-l-orange-400' :
                    order.status === 'Preparing' ? 'border-l-yellow-400' :
                    order.status === 'Ready' ? 'border-l-neon-cyan' :
                    order.status === 'Delivered' ? 'border-l-green-400' :
                    order.status === 'Cancelled' ? 'border-l-red-400' :
                    'border-l-neon-purple'
                  }`}
                  onClick={() => setSelectedOrderDetails(order)}
                >
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="flex-1 w-full sm:w-auto">
                      <h3 className="text-lg font-bold text-theme-text/90 flex items-center gap-2">
                        <span className="truncate">{order.customerName}</span>
                        {isDelayed && (
                          <span className="text-[10px] uppercase font-black bg-red-500/20 text-red-500 px-2 py-0.5 rounded-full border border-red-500/50 blink-slow">
                            ⚠️ Delayed
                          </span>
                        )}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-theme-text/40 mt-1">
                        <span className="flex items-center gap-1 shrink-0">
                          <Table className="w-3 h-3 shrink-0" /> Table {order.tableNumber}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3 shrink-0" /> {new Date(order.timestamp).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    <div className="text-left sm:text-right flex flex-row sm:flex-col items-center sm:items-end gap-3 sm:gap-2 w-full sm:w-auto justify-between sm:justify-start" onClick={(e) => e.stopPropagation()}>
                      {updatingOrderId === order.id ? (
                        <div className="px-2 py-1 flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                          <span className="text-xs text-theme-text/60">Updating...</span>
                        </div>
                      ) : (
                        <select 
                          value={order.status}
                          onChange={(e) => {
                            setConfirmStatusChange({ id: order.id, newStatus: e.target.value as OrderStatus });
                          }}
                          className={`rounded-lg px-2 py-1 text-xs font-bold focus:outline-none cursor-pointer ${getStatusColor(order.status)}`}
                        >
                          <option value="Pending">Pending</option>
                          <option value="Preparing">Preparing</option>
                          <option value="Ready">Ready</option>
                          <option value="Delivered">Delivered</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                      )}
                      <p className="text-xl font-bold neon-text-purple mt-1">₹{order.totalPrice}</p>
                    </div>
                  </div>
                  
                  <div className="bg-glass rounded-xl p-3 text-center text-xs text-theme-text/40 font-medium hover:text-theme-text/60 transition-colors">
                    Click to view order details ({order.items.reduce((acc, item) => acc + item.quantity, 0)} items)
                  </div>
                </motion.div>
                );
              })
            )}

            {/* Order Details Modal */}
            <AnimatePresence>
              {selectedOrderDetails && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="glass-panel p-6 max-w-md w-full space-y-6 border border-glass-border shadow-2xl relative"
                    style={{ backgroundColor: '#0f0f0f' }}
                  >
                    <button 
                      onClick={() => setSelectedOrderDetails(null)}
                      className="absolute top-4 right-4 p-2 rounded-full hover:bg-glass-hover transition-colors"
                    >
                      <LogOut className="w-5 h-5 opacity-60 hover:opacity-100" />
                    </button>
                    
                    <div>
                      <h2 className="text-xl font-bold neon-text-purple mb-1">Order Details</h2>
                      <div className="flex gap-3 text-sm text-theme-text/60">
                        <span><strong className="text-theme-text">Customer:</strong> {selectedOrderDetails.customerName}</span>
                        <span>•</span>
                        <span><strong className="text-theme-text">Table:</strong> {selectedOrderDetails.tableNumber}</span>
                      </div>
                      <div className="text-xs text-theme-text/40 mt-1">
                        Placed at: {new Date(selectedOrderDetails.timestamp).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    <div className="bg-glass rounded-xl p-4 max-h-[40vh] overflow-y-auto">
                      <ul className="space-y-3">
                        {selectedOrderDetails.items.map((item, idx) => (
                          <li key={idx} className="flex flex-col text-sm border-b border-glass pb-2 last:border-0 last:pb-0">
                            <div className="flex justify-between items-center">
                              <span className="font-medium text-white/80">{item.name} <span className="text-neon-cyan px-2 py-0.5 rounded-md bg-glass text-xs ml-2">x{item.quantity}</span></span>
                              <span className="text-theme-text/60">₹{item.price * item.quantity}</span>
                            </div>
                            {item.notes && <p className="text-xs text-orange-300 italic opacity-80 mt-1 pl-2 border-l-2 border-orange-300/30">Note: {item.notes}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                    
                    <div className="flex justify-between items-center pt-2 border-t border-glass">
                      <span className="font-bold text-theme-text/60 uppercase tracking-wider text-sm">Total Amount</span>
                      <span className="text-2xl font-bold neon-text-purple">₹{selectedOrderDetails.totalPrice}</span>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                      <button 
                        onClick={() => generateInvoice(selectedOrderDetails)}
                        className="px-4 py-2 bg-neon-purple/20 text-neon-purple border border-neon-purple/50 rounded-xl font-medium hover:bg-neon-purple/30 transition-colors flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Print Invoice
                      </button>
                      <button 
                        onClick={() => setSelectedOrderDetails(null)}
                        className="px-4 py-2 bg-glass rounded-xl font-medium hover:bg-glass-hover transition-colors"
                      >
                        Close
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : view === 'menu' ? (
          <motion.div
            key="menu-mgmt"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            {/* Header Blocks Container */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div 
                className="glass-panel px-4 py-2 flex items-center h-full"
                style={{
                  minHeight: '66px',
                  height: 'auto'
                }}
              >
                <div 
                  className="flex justify-between items-center w-full flex-nowrap gap-2"
                >
                <h2 
                  className="font-bold neon-text-purple flex items-center gap-1 sm:gap-2 pl-0 flex-shrink"
                  style={{
                    height: '50px',
                    fontSize: '16px',
                    border: 'none',
                    borderRadius: '12px',
                    width: 'auto',
                    minWidth: 'auto',
                    marginRight: 'auto'
                  }}
                >
                  <Utensils className="w-4 h-4 flex-shrink-0 hidden sm:block" />
                  <span className="truncate">Menu Management</span>
                </h2>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setNewItemName('');
                    setNewItemPrice('');
                    setNewItemImage(null);
                    setNewItemCategory('');
                    setIsDishModalOpen(true);
                  }}
                  className="bg-neon-purple text-white px-2 sm:px-4 py-2 rounded-xl font-bold flex items-center gap-1 sm:gap-2 neon-shadow-purple hover:scale-105 transition-all h-[40px] sm:h-[50px] whitespace-nowrap justify-center flex-shrink-0 text-sm sm:text-base w-auto sm:w-[140px]"
                >
                  <Plus className="w-4 h-4 flex-shrink-0" />
                  <span>Add Dish</span>
                </button>
              </div>
            </div>

            {/* Add/Edit Item Modal */}
            <AnimatePresence>
              {isDishModalOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.5, y: 100, rotateX: 45 }}
                    animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
                    exit={{ opacity: 0, scale: 0.5, y: 100, rotateX: 45 }}
                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    className="glass-panel p-6 max-w-2xl w-full space-y-6 border border-glass-border overflow-y-auto max-h-[90vh] perspective-1000 shadow-2xl"
                    style={{
                      backgroundColor: '#050505',
                      backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.03))'
                    }}
                  >
                    <div className="flex justify-between items-center">
                      <h2 className="text-2xl font-bold neon-text-purple flex items-center gap-2">
                        {editingItem ? <Edit2 className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                        {editingItem ? 'Edit Dish' : 'Add New Dish'}
                      </h2>
                      <button 
                        onClick={() => setIsDishModalOpen(false)}
                        className="p-2 hover:bg-glass-hover rounded-full transition-all"
                      >
                        <LogOut className="w-6 h-6 rotate-180" />
                      </button>
                    </div>
                    
                    <form onSubmit={handleAddItem} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Dish Name</label>
                          <input
                            type="text"
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            placeholder="e.g. Paneer Butter Masala"
                            className="w-full bg-glass border border-glass rounded-xl px-4 py-3 focus:outline-none focus:border-neon-purple/50 transition-all text-theme-text"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Price (₹)</label>
                          <input
                            type="number"
                            value={newItemPrice}
                            onChange={(e) => setNewItemPrice(e.target.value)}
                            placeholder="e.g. 250"
                            className="w-full bg-glass border border-glass rounded-xl px-4 py-3 focus:outline-none focus:border-neon-purple/50 transition-all text-theme-text"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Category</label>
                          <select
                            value={newItemCategory}
                            onChange={(e) => setNewItemCategory(e.target.value)}
                            className="w-full bg-glass text-theme-text border border-glass rounded-xl px-4 py-3 focus:outline-none focus:border-neon-purple/50 transition-all"
                          >
                            <option value="" className="text-black">Select Category</option>
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.id} className="text-black">{cat.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Dish Image</label>
                        <div className="flex items-center gap-4">
                          <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 border-2 border-dashed border-glass rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-neon-purple/50 hover:bg-neon-purple/5 transition-all group"
                          >
                            {newItemImage ? (
                              <img src={newItemImage} alt="Preview" className="w-32 h-32 object-cover rounded-xl border border-glass" />
                            ) : (
                              <>
                                <Plus className="w-8 h-8 text-white/20 group-hover:text-neon-purple transition-all" />
                                <p className="text-xs text-theme-text/30 mt-2">Click to upload image (Max 5MB)</p>
                              </>
                            )}
                            <input 
                              type="file" 
                              ref={fileInputRef}
                              onChange={handleImageUpload}
                              accept="image/*"
                              className="hidden"
                            />
                          </div>
                          {newItemImage && (
                            <button 
                              type="button"
                              onClick={() => setNewItemImage(null)}
                              className="p-3 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <button
                          id="add-dish-btn"
                          type="submit"
                          disabled={isSubmittingMenu}
                          className="flex-1 bg-neon-purple text-white py-4 rounded-xl font-bold hover:scale-[1.01] active:scale-[0.99] transition-all neon-shadow-purple flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100 disabled:neon-shadow-none"
                        >
                          {isSubmittingMenu ? (
                            <>
                              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                              Saving...
                            </>
                          ) : (
                            editingItem ? 'Update Dish' : 'Add Dish to Menu'
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isSubmittingMenu}
                          onClick={() => setIsDishModalOpen(false)}
                          className="px-6 py-4 rounded-xl bg-glass border border-glass font-bold hover:bg-glass-hover transition-all disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Manage Categories Block */}
              <div 
                className="glass-panel px-4 py-2 flex items-center h-full"
                style={{
                  minHeight: '66px',
                  height: 'auto'
                }}
              >
                <div 
                  className="flex justify-between items-center w-full flex-nowrap gap-2"
                >
                <h2 
                  className="font-bold neon-text-purple flex items-center gap-1 sm:gap-2 pl-0 flex-shrink"
                  style={{
                    height: '50px',
                    fontSize: '16px',
                    border: 'none',
                    borderRadius: '12px',
                    width: 'auto',
                    minWidth: 'auto',
                    marginRight: 'auto'
                  }}
                >
                  <Table className="w-4 h-4 flex-shrink-0 hidden sm:block" />
                  <span className="truncate">Manage Categories</span>
                </h2>
                <button
                  onClick={() => {
                    setEditingCategory(null);
                    setNewCategoryName('');
                    setIsCategoryModalOpen(true);
                  }}
                  className="bg-neon-purple text-white px-2 sm:px-4 py-2 rounded-xl font-bold flex items-center gap-1 sm:gap-2 neon-shadow-purple hover:scale-105 transition-all h-[40px] sm:h-[50px] whitespace-nowrap justify-center flex-shrink-0 text-sm sm:text-base w-auto sm:w-[140px]"
                >
                  <Plus className="w-4 h-4 flex-shrink-0" />
                  <span>Add Category</span>
                </button>
              </div>
            </div>
            </div>

            <section className="space-y-6">
              {/* Category Modal */}
              <AnimatePresence>
                {isCategoryModalOpen && (
                  <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.5, y: 100, rotateX: 45 }}
                      animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
                      exit={{ opacity: 0, scale: 0.5, y: 100, rotateX: 45 }}
                      transition={{ type: "spring", damping: 25, stiffness: 200 }}
                      className="glass-panel p-6 max-w-md w-full space-y-6 border border-glass-border perspective-1000 shadow-2xl"
                      style={{
                        backgroundColor: '#050505',
                        backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.03))'
                      }}
                    >
                      <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold neon-text-purple flex items-center gap-2">
                          {editingCategory ? <Edit2 className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                          {editingCategory ? 'Edit Category' : 'Add Category'}
                        </h2>
                        <button 
                          onClick={() => setIsCategoryModalOpen(false)}
                          className="p-2 hover:bg-glass-hover rounded-full transition-all"
                        >
                          <LogOut className="w-6 h-6 rotate-180" />
                        </button>
                      </div>

                      <form onSubmit={handleAddCategory} className="space-y-6">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest text-theme-text font-bold">Category Name</label>
                          <input
                            type="text"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder="e.g. Main Course"
                            className="w-full bg-glass border border-glass rounded-xl px-4 py-3 focus:outline-none focus:border-neon-purple/50 transition-all text-theme-text"
                          />
                        </div>
                        <div className="flex gap-4">
                          <button
                            id="add-cat-btn"
                            type="submit"
                            disabled={isSubmittingCategory}
                            className="flex-1 bg-neon-purple text-white py-4 rounded-xl font-bold hover:scale-[1.01] active:scale-[0.99] transition-all neon-shadow-purple flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100 disabled:neon-shadow-none"
                          >
                            {isSubmittingCategory ? (
                              <>
                                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                Saving...
                              </>
                            ) : (
                              editingCategory ? 'Update Category' : 'Add Category'
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={isSubmittingCategory}
                            onClick={() => setIsCategoryModalOpen(false)}
                            className="px-6 py-4 rounded-xl bg-glass border border-glass font-bold hover:bg-glass-hover transition-all disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              <div className="flex flex-col gap-3">
                {displayCategories.map((cat, index) => (
                  <div 
                    key={cat.id} 
                    className="flex items-center justify-between p-3 rounded-2xl border border-glass-border shadow-2xl group transition-all"
                    style={{
                      backgroundColor: '#080808',
                      backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.03))'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-theme-text">{cat.name}</span>
                    </div>
                    <div className="flex gap-1 sm:gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
                      <button 
                        onClick={() => {
                          setEditingCategory(cat);
                          setNewCategoryName(cat.name);
                          setIsCategoryModalOpen(true);
                        }}
                        className="p-1.5 text-neon-purple hover:bg-neon-purple/10 rounded-lg transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => deleteCategory(cat.id)}
                        className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <ConfirmModal 
                isOpen={!!confirmDeleteCatId}
                title="Delete Category"
                message="Delete this category? Items in this category will move to 'Other'."
                onConfirm={async () => {
                  if (confirmDeleteCatId) {
                    try {
                      await deleteDoc(doc(db, 'categories', confirmDeleteCatId));
                      showNotification("Category deleted!");
                    } catch (error) {
                      handleFirestoreError(error, OperationType.DELETE, `categories/${confirmDeleteCatId}`);
                    }
                    setConfirmDeleteCatId(null);
                  }
                }}
                onCancel={() => setConfirmDeleteCatId(null)}
              />
            </section>

            {/* Low Stock Alert */}
            {menu.filter(item => item.stockCount !== undefined && item.stockCount <= (item.lowStockThreshold || 5)).length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-xl p-4 flex gap-3 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
                <div className="mt-0.5 text-yellow-500">
                  ⚠️
                </div>
                <div>
                  <h3 className="text-yellow-500 font-bold text-sm">Low Stock Alert</h3>
                  <p className="text-xs text-yellow-500/80 mt-1">
                    The following items are running low on stock:
                    <span className="font-bold ml-1">
                      {menu.filter(item => item.stockCount !== undefined && item.stockCount <= (item.lowStockThreshold || 5)).map(i => i.name).join(', ')}
                    </span>
                  </p>
                </div>
              </div>
            )}

            {/* Current Menu List */}
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-theme-text/90">Current Menu</h2>
                  {/* Bulk actions removed */}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <input
                    id="menu-search-input"
                    type="text"
                    value={menuSearchQuery}
                    onChange={(e) => setMenuSearchQuery(e.target.value)}
                    placeholder="Search dishes... (Ctrl+F)"
                    className="bg-glass border border-glass rounded-xl px-4 py-2 focus:outline-none focus:border-neon-purple/50 transition-all text-sm"
                  />
                  <select
                    value={menuFilterCategory}
                    onChange={(e) => setMenuFilterCategory(e.target.value)}
                    className="bg-glass border border-glass rounded-xl px-4 py-2 focus:outline-none focus:border-neon-purple/50 transition-all text-sm text-theme-text"
                  >
                    <option value="All" className="text-black">All Categories</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id} className="text-black">{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {menu
                  .filter(item => {
                    const matchesSearch = item.name.toLowerCase().includes(menuSearchQuery.toLowerCase());
                    const matchesCategory = menuFilterCategory === 'All' || item.categoryId === menuFilterCategory;
                    return matchesSearch && matchesCategory;
                  })
                  .map((item) => {
                    const isLowStock = item.stockCount !== undefined && item.stockCount <= (item.lowStockThreshold || 5);
                    return (
                    <div key={item.id} className={`glass-panel p-3 flex items-center gap-4 transition-all ${item.isAvailable === false ? 'opacity-50 grayscale border-red-500/30' : isLowStock ? 'border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.2)]' : ''}`}>

                      <img src={item.image} alt={item.name} className="w-12 h-12 rounded-lg object-cover" />
                      <div className="flex-1">
                        <h3 className="font-medium">{item.name}</h3>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <p className="text-neon-purple text-sm font-bold">₹{item.price}</p>
                          {item.categoryId && (
                            <span className="text-[10px] uppercase tracking-widest text-white/20 bg-glass px-2 py-0.5 rounded-full">
                              {categories.find(c => c.id === item.categoryId)?.name || 'Unknown'}
                            </span>
                          )}
                          {item.isAvailable === false ? (
                            <span className="text-[10px] uppercase tracking-widest text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full font-bold shadow-[0_0_8px_rgba(239,68,68,0.3)]">
                              Sold Out
                            </span>
                          ) : isLowStock ? (
                            <span className="text-[10px] uppercase tracking-widest text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                              ⚠️ Low Stock: {item.stockCount}
                            </span>
                          ) : item.stockCount !== undefined ? (
                            <span className="text-[10px] uppercase tracking-widest text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                              Stock: {item.stockCount}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex gap-2 items-center">
                        <label className="flex items-center cursor-pointer mr-2" title="Toggle Availability">
                          <div className="relative">
                          <input 
                            type="checkbox" 
                            className="sr-only" 
                            checked={item.isAvailable !== false} 
                            onChange={() => toggleItemAvailability(item)} 
                          />
                          <div className={`block w-10 h-6 rounded-full transition-colors ${item.isAvailable !== false ? 'bg-neon-purple' : 'bg-white/20'}`}></div>
                          <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${item.isAvailable !== false ? 'transform translate-x-4' : ''}`}></div>
                        </div>
                      </label>
                      <button
                        onClick={() => startEdit(item)}
                        className="p-2 rounded-lg text-white/20 hover:text-neon-purple hover:bg-neon-purple/10 transition-all"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(item.id)}
                        className="p-2 rounded-lg text-white/20 hover:text-red-500 hover:bg-red-500/10 transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>

              <ConfirmModal 
                isOpen={!!confirmDeleteId}
                title="Delete Menu Item"
                message="Are you sure you want to remove this item from the menu?"
                onConfirm={async () => {
                  if (confirmDeleteId) {
                    try {
                      await deleteDoc(doc(db, 'menu', confirmDeleteId));
                      showNotification("Item removed.");
                    } catch (error) {
                      handleFirestoreError(error, OperationType.DELETE, `menu/${confirmDeleteId}`);
                    }
                    setConfirmDeleteId(null);
                  }
                }}
                onCancel={() => setConfirmDeleteId(null)}
              />
            </section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
