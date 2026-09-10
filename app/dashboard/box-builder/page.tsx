// app/dashboard/box-builder/page.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase'; // Fixed Supabase client import

interface Box {
  id: string;
  box_number: string;
  grade: string;
  status: 'OPEN' | 'CLOSED';
  created_by: string;
  created_at: string;
  closed_by?: string;
  closed_at?: string;
  profiles?: { full_name?: string; email?: string };
}

interface BoxItem {
  id: string;
  box_id: string;
  imei: string;
  added_at: string;
  model?: string;
  gb?: string | number;
  color?: string;
  spec?: string;
  lookupError?: string;
}

const AVAILABLE_GRADES = [
  'A++',
  'A/A+',
  'A/B',
  'Fair',
  'B/C',
  'Mix',
  'Non graded',
  'R',
  'G',
  'P',
];

export default function BoxBuilderDashboard() {
  const [activeTab, setActiveTab] = useState<'open' | 'history'>('open');
  const [openBoxes, setOpenBoxes] = useState<Box[]>([]);
  const [closedBoxes, setClosedBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [boxItems, setBoxItems] = useState<BoxItem[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [scanMessage, setScanMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchBoxes();
  }, []);

  const fetchBoxes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('boxes')
        .select(`*, profiles:created_by(full_name, email)`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        setOpenBoxes(data.filter((b: Box) => b.status === 'OPEN'));
        setClosedBoxes(data.filter((b: Box) => b.status === 'CLOSED'));
      }
    } catch (err: any) {
      console.error('Error fetching boxes:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewBox = async () => {
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Authentication required.');
        return;
      }

      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const prefix = `BOX-${todayStr}-`;

      const { data: existingBoxes, error: fetchErr } = await supabase
        .from('boxes')
        .select('box_number')
        .ilike('box_number', `${prefix}%`)
        .order('box_number', { ascending: false })
        .limit(1);

      if (fetchErr) throw fetchErr;

      let nextSeq = 1;
      if (existingBoxes && existingBoxes.length > 0) {
        const lastBoxNum = existingBoxes[0].box_number;
        const seqPart = lastBoxNum.split('-')[2];
        if (seqPart) {
          nextSeq = parseInt(seqPart, 10) + 1;
        }
      }

      const newBoxNumber = `${prefix}${String(nextSeq).padStart(5, '0')}`;

      const { data: insertedBox, error: insertErr } = await supabase
        .from('boxes')
        .insert({
          box_number: newBoxNumber,
          grade: 'Mix',
          status: 'OPEN',
          created_by: user.id,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      await fetchBoxes();
      if (insertedBox) {
        openBoxDetail(insertedBox);
      }
    } catch (err: any) {
      console.error('Error creating box:', err.message);
      alert('Failed to create box: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const openBoxDetail = async (box: Box) => {
    setSelectedBox(box);
    setScanMessage(null);
    await loadBoxItems(box.id);
  };

  const loadBoxItems = async (boxId: string) => {
    try {
      const { data: items, error } = await supabase
        .from('box_items')
        .select('*')
        .eq('box_id', boxId)
        .order('added_at', { ascending: false });

      if (error) throw error;

      if (!items) {
        setBoxItems([]);
        return;
      }

      const enrichedItems: BoxItem[] = await Promise.all(
        items.map(async (item: any) => {
          try {
            const { data: deviceData, error: devErr } = await supabase
              .from('devices')
              .select('model, gb, storage, color, spec, region')
              .eq('imei', item.imei)
              .maybeSingle();

            if (devErr || !deviceData) {
              return { 
                ...item, 
                model: 'Unknown Model',
                gb: item.gb || 'N/A',
                color: item.color || 'N/A',
                spec: item.spec || 'Standard',
                lookupError: 'Not found in Main DB' 
              };
            }

            return {
              ...item,
              model: deviceData.model || 'Unknown Model',
              gb: item.gb || deviceData.gb || deviceData.storage || 'N/A',
              color: item.color || deviceData.color || 'N/A',
              spec: deviceData.spec || deviceData.region || 'Standard',
            };
          } catch {
            return { ...item, lookupError: 'Lookup failed' };
          }
        })
      );

      setBoxItems(enrichedItems);
    } catch (err: any) {
      console.error('Error loading box items:', err.message);
    }
  };

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanInput.trim() || !selectedBox || selectedBox.status === 'CLOSED') return;

    const imeiToScan = scanInput.trim();
    setScanInput('');
    setScanning(true);
    setScanMessage(null);

    try {
      const { data: deviceRecord, error: devError } = await supabase
        .from('devices')
        .select('model, gb, storage, color, spec, region')
        .eq('imei', imeiToScan)
        .maybeSingle();

      if (devError || !deviceRecord) {
        setScanMessage({
          type: 'error',
          text: `❌ IMEI NOT FOUND IN MAIN DATABASE (${imeiToScan})`,
        });
        setScanning(false);
        focusInput();
        return;
      }

      const { data: activeRepairs, error: repError } = await supabase
        .from('repair_request_items')
        .select('repair_request_id, status')
        .eq('imei', imeiToScan)
        .in('status', ['pending', 'repairing', 'in_progress']);

      if (!repError && activeRepairs && activeRepairs.length > 0) {
        setScanMessage({
          type: 'error',
          text: `❌ IMEI IN REPAIRING STATUS: This phone cannot be added to a box while it is under repair.`,
        });
        setScanning(false);
        focusInput();
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();

      await supabase.from('box_items').delete().eq('imei', imeiToScan);

      const { error: insertItemErr } = await supabase.from('box_items').insert({
        box_id: selectedBox.id,
        imei: imeiToScan,
        gb: String(deviceRecord.gb || deviceRecord.storage || ''),
        color: String(deviceRecord.color || ''),
        added_by: user?.id,
      });

      if (insertItemErr) throw insertItemErr;

      setScanMessage({
        type: 'success',
        text: `Successfully added IMEI ${imeiToScan} (${deviceRecord.model})`,
      });

      await loadBoxItems(selectedBox.id);
      await fetchBoxes();
    } catch (err: any) {
      console.error('Scan error:', err.message);
      setScanMessage({ type: 'error', text: `Error: ${err.message}` });
    } finally {
      setScanning(false);
      focusInput();
    }
  };

  const focusInput = () => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleRemoveImei = async (imei: string) => {
    if (!confirm(`Are you sure you want to remove IMEI ${imei} from this box?`)) return;

    try {
      const { error } = await supabase.from('box_items').delete().eq('imei', imei);
      if (error) throw error;

      if (selectedBox) {
        await loadBoxItems(selectedBox.id);
        await fetchBoxes();
      }
    } catch (err: any) {
      alert('Failed to remove IMEI: ' + err.message);
    }
  };

  const handleGradeChange = async (newGrade: string) => {
    if (!selectedBox || selectedBox.status === 'CLOSED') return;

    try {
      const { error } = await supabase
        .from('boxes')
        .update({ grade: newGrade })
        .eq('id', selectedBox.id);

      if (error) throw error;

      setSelectedBox({ ...selectedBox, grade: newGrade });
      await fetchBoxes();
    } catch (err: any) {
      alert('Failed to update grade: ' + err.message);
    }
  };

  const handleCloseBox = async () => {
    if (!selectedBox) return;
    if (!confirm('Are you sure you want to close this box? Once closed, it cannot accept new IMEIs.')) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('boxes')
        .update({
          status: 'CLOSED',
          closed_by: user?.id,
          closed_at: new Date().toISOString(),
        })
        .eq('id', selectedBox.id);

      if (error) throw error;

      alert('Box closed successfully.');
      setSelectedBox(null);
      await fetchBoxes();
    } catch (err: any) {
      alert('Failed to close box: ' + err.message);
    }
  };

  const handlePrintBox = () => {
    window.print();
  };

  const getGroupedSummary = () => {
    const groups: { [key: string]: { model: string; color: string; gb: string; spec: string; count: number } } = {};

    boxItems.forEach((item) => {
      const key = `${item.model || 'Unknown'} - ${item.color || 'N/A'} - ${item.gb || 'N/A'}GB - ${item.spec || 'Standard'}`;
      if (!groups[key]) {
        groups[key] = {
          model: item.model || 'Unknown',
          color: item.color || 'N/A',
          gb: String(item.gb || 'N/A'),
          spec: item.spec || 'Standard',
          count: 0,
        };
      }
      groups[key].count += 1;
    });

    return Object.values(groups);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="print:hidden">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            📦 Box Builder
          </h1>
          {!selectedBox && (
            <button
              onClick={handleCreateNewBox}
              disabled={creating}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow transition disabled:opacity-50"
            >
              {creating ? 'Creating...' : '+ Create New Box'}
            </button>
          )}
        </div>

        {selectedBox ? (
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
            <div className="flex justify-between items-start border-b pb-4 mb-6">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-gray-900">{selectedBox.box_number}</h2>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      selectedBox.status === 'OPEN'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {selectedBox.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Created: {new Date(selectedBox.created_at).toLocaleString()}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedBox(null)}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  ← Back to Boxes
                </button>
                <button
                  onClick={handlePrintBox}
                  className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 flex items-center gap-1.5"
                >
                  🖨️ Print Box
                </button>
                {selectedBox.status === 'OPEN' && (
                  <button
                    onClick={handleCloseBox}
                    className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                  >
                    Close Box
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 p-4 rounded-lg border">
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                  Box Grade
                </label>
                {selectedBox.status === 'OPEN' ? (
                  <select
                    value={selectedBox.grade}
                    onChange={(e) => handleGradeChange(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-md px-3 py-1.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {AVAILABLE_GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-lg font-bold text-gray-800">{selectedBox.grade}</span>
                )}
              </div>

              <div className="bg-gray-50 p-4 rounded-lg border">
                <span className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                  Total Phones
                </span>
                <span className="text-2xl font-bold text-blue-600">{boxItems.length}</span>
              </div>
            </div>

            {selectedBox.status === 'OPEN' && (
              <form onSubmit={handleScanSubmit} className="mb-6 bg-blue-50 p-4 rounded-xl border border-blue-100">
                <label className="block text-sm font-bold text-blue-900 mb-2">
                  Scan IMEI (Rapid Scanner)
                </label>
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder="Scan barcode or type IMEI and press Enter..."
                    disabled={scanning}
                    autoFocus
                    className="flex-1 border border-blue-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white shadow-inner"
                  />
                  <button
                    type="submit"
                    disabled={scanning || !scanInput.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium shadow transition disabled:opacity-50"
                  >
                    {scanning ? 'Adding...' : 'Add IMEI'}
                  </button>
                </div>
                {scanMessage && (
                  <div
                    className={`mt-3 p-3 rounded-lg text-sm font-medium ${
                      scanMessage.type === 'success'
                        ? 'bg-green-100 text-green-800 border border-green-200'
                        : 'bg-red-100 text-red-800 border border-red-200'
                    }`}
                  >
                    {scanMessage.text}
                  </div>
                )}
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                    <th className="p-3">#</th>
                    <th className="p-3">IMEI</th>
                    <th className="p-3">Model</th>
                    <th className="p-3">GB</th>
                    <th className="p-3">Color</th>
                    <th className="p-3">Spec</th>
                    <th className="p-3">Status</th>
                    {selectedBox.status === 'OPEN' && <th className="p-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-sm">
                  {boxItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-gray-400">
                        No devices scanned into this box yet.
                      </td>
                    </tr>
                  ) : (
                    boxItems.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="p-3 text-gray-500 font-medium">{idx + 1}</td>
                        <td className="p-3 font-mono font-semibold text-gray-800">{item.imei}</td>
                        <td className="p-3 text-gray-700">{item.model || '—'}</td>
                        <td className="p-3 text-gray-700">{item.gb ? `${item.gb}GB` : '—'}</td>
                        <td className="p-3 text-gray-700">{item.color || '—'}</td>
                        <td className="p-3 text-gray-700">{item.spec || '—'}</td>
                        <td className="p-3">
                          {item.lookupError ? (
                            <span className="text-red-600 font-semibold text-xs">⚠️ {item.lookupError}</span>
                          ) : (
                            <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-semibold">
                              Added
                            </span>
                          )}
                        </td>
                        {selectedBox.status === 'OPEN' && (
                          <td className="p-3 text-right">
                            <button
                              onClick={() => handleRemoveImei(item.imei)}
                              className="text-red-600 hover:text-red-800 text-xs font-medium px-2 py-1 bg-red-50 hover:bg-red-100 rounded transition"
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex border-b border-gray-200 mb-6">
              <button
                onClick={() => setActiveTab('open')}
                className={`py-2.5 px-6 font-semibold text-sm border-b-2 transition ${
                  activeTab === 'open'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Open Boxes ({openBoxes.length})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-2.5 px-6 font-semibold text-sm border-b-2 transition ${
                  activeTab === 'history'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Box History / Closed ({closedBoxes.length})
              </button>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-500">Loading boxes...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(activeTab === 'open' ? openBoxes : closedBoxes).length === 0 ? (
                  <div className="col-span-full text-center py-12 bg-white rounded-xl border border-gray-200 text-gray-400">
                    No {activeTab === 'open' ? 'open' : 'closed'} boxes found.
                  </div>
                ) : (
                  (activeTab === 'open' ? openBoxes : closedBoxes).map((box) => (
                    <div
                      key={box.id}
                      className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex justify-between items-start mb-3">
                          <h3 className="font-bold text-gray-900 text-lg">{box.box_number}</h3>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              box.status === 'OPEN'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {box.grade}
                          </span>
                        </div>
                        <div className="space-y-1 text-sm text-gray-600 mb-4">
                          <p>
                            <span className="font-medium">Status:</span> {box.status}
                          </p>
                          <p>
                            <span className="font-medium">Created By:</span>{' '}
                            {box.profiles?.full_name || box.profiles?.email || 'User'}
                          </p>
                          <p>
                            <span className="font-medium">Created At:</span>{' '}
                            {new Date(box.created_at).toLocaleDateString()}
                          </p>
                          {box.status === 'CLOSED' && box.closed_at && (
                            <p>
                              <span className="font-medium">Closed At:</span>{' '}
                              {new Date(box.closed_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => openBoxDetail(box)}
                        className="w-full bg-gray-100 hover:bg-blue-600 hover:text-white text-gray-800 font-medium py-2 rounded-lg text-sm transition text-center"
                      >
                        {box.status === 'OPEN' ? 'Open & Scan ➔' : 'View Closed Box ➔'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedBox && (
        <div className="hidden print:block p-8 bg-white text-black">
          <div className="text-center border-b-2 border-black pb-4 mb-6">
            <h1 className="text-3xl font-bold tracking-wider">BOX LABEL</h1>
            <h2 className="text-2xl font-mono mt-2">{selectedBox.box_number}</h2>
            <div className="mt-2 text-lg font-semibold">Grade: {selectedBox.grade}</div>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold border-b border-black pb-1 mb-3">Grouped Device Summary</h3>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black text-xs uppercase">
                  <th className="py-2">#</th>
                  <th className="py-2">Model</th>
                  <th className="py-2">Color</th>
                  <th className="py-2">GB</th>
                  <th className="py-2">Spec/Region</th>
                  <th className="py-2 text-right">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-300 text-sm">
                {getGroupedSummary().map((group, idx) => (
                  <tr key={idx}>
                    <td className="py-2">{idx + 1}</td>
                    <td className="py-2 font-semibold">{group.model}</td>
                    <td className="py-2">{group.color}</td>
                    <td className="py-2">{group.gb}GB</td>
                    <td className="py-2">{group.spec}</td>
                    <td className="py-2 text-right font-bold">{group.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center border-t-2 border-black pt-4 font-bold text-xl">
            <span>TOTAL PHONES:</span>
            <span>{boxItems.length} PHONES</span>
          </div>

          <div className="mt-12 text-center text-xs text-gray-500">
            Generated on {new Date().toLocaleString()} • Authorized Box Builder System
          </div>
        </div>
      )}
    </div>
  );
}